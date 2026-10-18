-- Exact schema parity with the live `school` project.
--
-- A database replayed from the earlier migrations differed from the live
-- project in ways a name-by-name comparison doesn't show. This file closes
-- every difference found by fingerprinting a full replay against the live
-- database, category by category (columns, constraints, indexes, policies,
-- triggers, function bodies and grants, enums, table grants, event
-- triggers, publications, storage), copying definitions from live.
--
-- Safe to run anywhere: every step first checks whether the object is
-- already as expected and skips it if so. On the live project it changes
-- nothing; on a database built from the repo it makes it identical.
--
-- Sections: 1 helpers; 2 enums; 3 constraint renames; 4 functions;
--           5 function grants; 6 constraints; 7 trigger; 8 grants, event
--           trigger, realtime publication, storage.
--
-- Deliberately NOT replicated: Supabase platform objects that exist on every
-- project already (its own event triggers, default privileges, the
-- realtime schema).

-- ----------------------------------------------------------------------------
-- 1. Helpers (temporary: dropped automatically at the end of the session)
-- ----------------------------------------------------------------------------

-- Brings one constraint to the exact definition `p_def`: adds it when
-- missing, replaces it when it differs, leaves it alone when it matches.
-- A UNIQUE constraint whose backing unique index already exists under the
-- same name (created by the earlier catch-up migration) is promoted with
-- ADD CONSTRAINT ... USING INDEX instead of building a second index.
create or replace function pg_temp.ensure_constraint(p_table text, p_name text, p_def text)
returns void language plpgsql as $f$
declare
  v_rel regclass := ('public.' || p_table)::regclass;
  v_cur text;
begin
  select pg_get_constraintdef(oid) into v_cur
  from pg_constraint where conrelid = v_rel and conname = p_name;

  if v_cur is not null then
    if v_cur = p_def then return; end if;
    execute format('alter table %s drop constraint %I', v_rel, p_name);
  end if;

  if p_def like 'UNIQUE (%' and v_cur is null
     and exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
                 where c.relname = p_name and c.relnamespace = 'public'::regnamespace
                   and i.indrelid = v_rel and i.indisunique and i.indpred is null) then
    execute format('alter table %s add constraint %I unique using index %I', v_rel, p_name, p_name);
  else
    execute format('alter table %s add constraint %I %s', v_rel, p_name, p_def);
  end if;
end $f$;

-- Rebuilds an enum type so its labels are exactly `p_labels`, in order.
-- Postgres can neither drop nor reorder enum labels, so the type is
-- replaced: the single column using it is converted, its default is
-- restored, and anything else that depends on it (policies on that column,
-- functions returning the type) is saved, dropped and recreated unchanged,
-- grants included. A no-op when the labels already match.
create or replace function pg_temp.rebuild_enum(p_type text, p_table text, p_column text, p_labels text[])
returns void language plpgsql as $f$
declare
  v_rel regclass := ('public.' || p_table)::regclass;
  v_attnum smallint;
  v_cur text[];
  v_default text;
  v_pol record;
  v_fn record;
  v_acl record;
  v_policies text[] := '{}';
  v_restore text[] := '{}';
  v_stmt text;
begin
  select array_agg(enumlabel::text order by enumsortorder) into v_cur
  from pg_enum where enumtypid = ('public.' || p_type)::regtype;
  if v_cur is not distinct from p_labels then return; end if;

  select attnum into v_attnum from pg_attribute where attrelid = v_rel and attname = p_column;
  select pg_get_expr(adbin, adrelid) into v_default
  from pg_attrdef where adrelid = v_rel and adnum = v_attnum;

  -- functions whose signature or result mentions the type: save, then drop
  for v_fn in
    select p.oid, p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def, p.proacl
    from pg_proc p
    join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = p.oid
      and d.refclassid = 'pg_type'::regclass and d.refobjid = ('public.' || p_type)::regtype
    where d.deptype = 'n'
  loop
    v_restore := v_restore || v_fn.def;
    if v_fn.proacl is not null then
      v_restore := v_restore || format('revoke all on function %s from public, anon, authenticated, service_role', v_fn.sig);
      for v_acl in select a.grantee from aclexplode(v_fn.proacl) a where a.privilege_type = 'EXECUTE' loop
        v_restore := v_restore || format('grant execute on function %s to %s', v_fn.sig,
          case when v_acl.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(v_acl.grantee)) end);
      end loop;
    end if;
    execute format('drop function %s', v_fn.sig);
  end loop;

  -- policies that depend on the column: save, then drop
  for v_pol in
    select p.polname, p.polrelid::regclass::text as tbl, p.polpermissive, p.polcmd,
           pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w,
           (select string_agg(case when r = 0 then 'public' else quote_ident(pg_get_userbyid(r)) end, ', ')
              from unnest(p.polroles) r) as roles
    from pg_policy p
    join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = p.oid
      and d.refclassid = 'pg_class'::regclass and d.refobjid = v_rel and d.refobjsubid = v_attnum
  loop
    v_policies := v_policies || format('create policy %I on %s as %s for %s to %s%s%s',
      v_pol.polname, v_pol.tbl,
      case when v_pol.polpermissive then 'permissive' else 'restrictive' end,
      case v_pol.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update'
                        when 'd' then 'delete' else 'all' end,
      v_pol.roles,
      case when v_pol.q is not null then format(' using (%s)', v_pol.q) else '' end,
      case when v_pol.w is not null then format(' with check (%s)', v_pol.w) else '' end);
    execute format('drop policy %I on %s', v_pol.polname, v_pol.tbl);
  end loop;

  execute format('alter type public.%I rename to %I', p_type, p_type || '_old');
  execute format('create type public.%I as enum (%s)', p_type,
                 (select string_agg(quote_literal(l), ', ' order by o) from unnest(p_labels) with ordinality as t(l, o)));
  if v_default is not null then
    execute format('alter table %s alter column %I drop default', v_rel, p_column);
  end if;
  execute format('alter table %s alter column %I type public.%I using %I::text::public.%I',
                 v_rel, p_column, p_type, p_column, p_type);
  if v_default is not null then
    execute format('alter table %s alter column %I set default %s', v_rel, p_column, v_default);
  end if;
  execute format('drop type public.%I_old', p_type);

  foreach v_stmt in array v_policies loop execute v_stmt; end loop;
  foreach v_stmt in array v_restore loop execute v_stmt; end loop;
end $f$;

-- ----------------------------------------------------------------------------
-- 2. Enums
--    Live carries `driver` (user_role, staff_role), `reviewed`
--    (homework_status) and `disciplinary` (student_note_type), which the app
--    uses, and lacks labels the early schema defined but nothing uses
--    (void, submitted, none, general, medical, concern).
-- ----------------------------------------------------------------------------

select pg_temp.rebuild_enum('user_role', 'profiles', 'role', array['student', 'teacher', 'admin', 'parent', 'driver']);
select pg_temp.rebuild_enum('staff_role', 'teacher_profiles', 'staff_role', array['teacher', 'hod', 'bursar', 'librarian', 'house_parent', 'transport_officer', 'driver']);
select pg_temp.rebuild_enum('homework_status', 'lessons', 'homework_status', array['given', 'reviewed', 'graded']);
select pg_temp.rebuild_enum('invoice_status', 'invoices', 'status', array['unpaid', 'partial', 'paid']);
select pg_temp.rebuild_enum('student_note_type', 'student_notes', 'note_type', array['behavioral', 'academic', 'commendation', 'disciplinary']);
select pg_temp.rebuild_enum('assessment_type', 'assessments', 'assessment_type', array['first_ca', 'second_ca', 'exam', 'test', 'assignment', 'project', 'practical', 'other', 'quiz']);

-- ----------------------------------------------------------------------------
-- 3. Constraints that exist on live under a different name
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_constraint where conrelid = 'public.quiz_answers'::regclass and conname = 'quiz_answers_attempt_question_unique')
     and not exists (select 1 from pg_constraint where conrelid = 'public.quiz_answers'::regclass and conname = 'quiz_answers_attempt_id_question_id_key') then
    alter table public.quiz_answers rename constraint quiz_answers_attempt_question_unique to quiz_answers_attempt_id_question_id_key;
  end if;
  if exists (select 1 from pg_constraint where conrelid = 'public.student_profiles'::regclass and conname = 'student_profiles_class_id_fkey')
     and not exists (select 1 from pg_constraint where conrelid = 'public.student_profiles'::regclass and conname = 'fk_student_class') then
    alter table public.student_profiles rename constraint student_profiles_class_id_fkey to fk_student_class;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 4. Functions (bodies copied from live)
-- ----------------------------------------------------------------------------

create or replace function public.borrow_library_book(p_book_id uuid, p_student_id uuid, p_due_at date)
 returns library_loans
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_available integer;
  v_loan library_loans;
BEGIN
  IF NOT (is_admin() OR is_librarian()) THEN
    RAISE EXCEPTION 'Only an admin or librarian can issue a loan.';
  END IF;

  IF p_due_at <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Due date must be in the future.';
  END IF;

  SELECT available_copies INTO v_available
  FROM library_books
  WHERE id = p_book_id AND NOT is_archived
  FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'Book not found or no longer in the catalog.';
  END IF;

  IF v_available <= 0 THEN
    RAISE EXCEPTION 'No copies of this book are currently available.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM library_loans
    WHERE book_id = p_book_id AND student_id = p_student_id AND returned_at IS NULL
  ) THEN
    RAISE EXCEPTION 'This student already has an active loan for this book.';
  END IF;

  UPDATE library_books SET available_copies = available_copies - 1 WHERE id = p_book_id;

  INSERT INTO library_loans (book_id, student_id, due_at, issued_by)
  VALUES (p_book_id, p_student_id, p_due_at, auth.uid())
  RETURNING * INTO v_loan;

  RETURN v_loan;
END;
$function$;

create or replace function public.check_grade_score_bounds()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
DECLARE
  v_max_score numeric;
BEGIN
  IF new.score < 0 THEN
    RAISE EXCEPTION 'Score cannot be negative.';
  END IF;

  SELECT max_score INTO v_max_score
  FROM assessments
  WHERE id = new.assessment_id;

  IF v_max_score IS NULL THEN
    RAISE EXCEPTION 'Assessment not found for this grade.';
  END IF;

  IF new.score > v_max_score THEN
    RAISE EXCEPTION 'Score (%) exceeds this assessment''s max score (%).', new.score, v_max_score;
  END IF;

  RETURN new;
END;
$function$;

create or replace function public.current_scheme_week()
 returns integer
 language sql
 stable
 set search_path to 'public'
as $function$
  SELECT CASE
    WHEN current_term_start_date IS NULL THEN NULL
    ELSE LEAST(
      GREATEST(1, (CURRENT_DATE - current_term_start_date) / 7 + 1),
      14
    )
  END
  FROM school_settings
  WHERE id = 1;
$function$;

create or replace function public.is_bursar()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM teacher_profiles tp
    JOIN profiles p ON p.id = tp.id
    WHERE tp.id = auth.uid()
      AND tp.staff_role = 'bursar'
      AND p.is_active = true
  );
$function$;

create or replace function public.is_librarian()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT EXISTS (
    SELECT 1
    FROM teacher_profiles tp
    JOIN profiles p ON p.id = tp.id
    WHERE tp.id = auth.uid()
      AND tp.staff_role = 'librarian'
      AND p.is_active = true
  );
$function$;

create or replace function public.log_receipt_print(p_payment_id uuid, p_reprint boolean default false)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
  VALUES (
    'payment', p_payment_id,
    CASE WHEN p_reprint THEN 'receipt_reprinted' ELSE 'receipt_printed' END,
    auth.uid(), '{}'::jsonb
  );
END;
$function$;

create or replace function public.record_invoice_payment(p_invoice_id uuid, p_amount_kobo bigint, p_method text, p_reference text default null::text, p_verified_by uuid default null::uuid, p_enforce_balance boolean default false)
 returns table(payment_id uuid, student_id uuid, amount_paid_kobo bigint, status invoice_status, already_recorded boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_existing_payment public.payments%ROWTYPE;
  v_payment_id uuid;
  v_new_paid bigint;
  v_status public.invoice_status;
  v_balance bigint;
  v_recorded_by uuid := auth.uid();
BEGIN
  IF p_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  IF p_method NOT IN ('cash', 'bank_transfer', 'card', 'other') THEN
    RAISE EXCEPTION 'Invalid payment method.';
  END IF;

  IF p_reference IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_reference));
    SELECT * INTO v_existing_payment FROM public.payments WHERE reference = p_reference;

    IF FOUND THEN
      IF v_existing_payment.invoice_id <> p_invoice_id THEN
        RAISE EXCEPTION 'This payment reference belongs to another invoice.';
      END IF;

      SELECT i.amount_paid_kobo, i.status INTO amount_paid_kobo, status
      FROM public.invoices AS i WHERE i.id = p_invoice_id;

      payment_id := v_existing_payment.id;
      student_id := v_existing_payment.student_id;
      already_recorded := true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;

  v_balance := v_invoice.total_amount_kobo - v_invoice.discount_kobo - v_invoice.amount_paid_kobo;
  IF p_enforce_balance AND p_amount_kobo > v_balance + 100 THEN
    RAISE EXCEPTION 'The verified payment amount does not match what is owed on this invoice.';
  END IF;

  v_new_paid := v_invoice.amount_paid_kobo + p_amount_kobo;
  v_status := CASE
    WHEN v_new_paid <= 0 THEN 'unpaid'::public.invoice_status
    WHEN v_new_paid >= v_invoice.total_amount_kobo - v_invoice.discount_kobo THEN 'paid'::public.invoice_status
    ELSE 'partial'::public.invoice_status
  END;

  INSERT INTO public.payments (invoice_id, student_id, amount_kobo, method, reference, verified_by)
  VALUES (p_invoice_id, v_invoice.student_id, p_amount_kobo, p_method, p_reference, p_verified_by)
  RETURNING id INTO v_payment_id;

  UPDATE public.invoices SET amount_paid_kobo = v_new_paid, status = v_status WHERE id = p_invoice_id;

  -- Audit entry: who actually submitted this recording action
  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
  VALUES (
    'payment', v_payment_id, 'payment_recorded', v_recorded_by,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'amount_kobo', p_amount_kobo,
      'method', p_method,
      'reference', p_reference,
      'verified_by', p_verified_by,
      'resulting_invoice_status', v_status
    )
  );

  payment_id := v_payment_id;
  student_id := v_invoice.student_id;
  amount_paid_kobo := v_new_paid;
  status := v_status;
  already_recorded := false;
  RETURN NEXT;
END;
$function$;

create or replace function public.log_curriculum_topic_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    VALUES (
      'curriculum_topic', NEW.id, 'curriculum_topic_created', auth.uid(),
      jsonb_build_object(
        'title', NEW.title,
        'subject_id', NEW.subject_id,
        'education_level', NEW.education_level,
        'level_number', NEW.level_number,
        'term', NEW.term,
        'academic_year', NEW.academic_year,
        'week_number', NEW.week_number,
        'sequence_order', NEW.sequence_order
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only log the fields that actually matter for scheme-of-work
    -- integrity (the ones a scheduling mistake or bad migration could
    -- silently corrupt), not every incidental column touch.
    IF NEW.week_number IS DISTINCT FROM OLD.week_number
       OR NEW.term IS DISTINCT FROM OLD.term
       OR NEW.academic_year IS DISTINCT FROM OLD.academic_year
       OR NEW.sequence_order IS DISTINCT FROM OLD.sequence_order
       OR NEW.title IS DISTINCT FROM OLD.title THEN
      INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
      VALUES (
        'curriculum_topic', NEW.id, 'curriculum_topic_updated', auth.uid(),
        jsonb_build_object(
          'title', NEW.title,
          'old_week_number', OLD.week_number, 'new_week_number', NEW.week_number,
          'old_term', OLD.term, 'new_term', NEW.term,
          'old_academic_year', OLD.academic_year, 'new_academic_year', NEW.academic_year,
          'old_sequence_order', OLD.sequence_order, 'new_sequence_order', NEW.sequence_order,
          'old_title', OLD.title
        )
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    VALUES (
      'curriculum_topic', OLD.id, 'curriculum_topic_deleted', auth.uid(),
      jsonb_build_object('title', OLD.title, 'subject_id', OLD.subject_id)
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

create or replace function public.log_enrollment_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
  VALUES (
    'enrollment',
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'enrollment_created' ELSE 'enrollment_updated' END,
    auth.uid(),
    jsonb_build_object(
      'student_id', NEW.student_id,
      'class_id', NEW.class_id,
      'academic_year', NEW.academic_year,
      'term', NEW.term,
      'old_class_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.class_id ELSE NULL END
    )
  );
  RETURN NEW;
END;
$function$;

create or replace function public.log_fee_structure_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    VALUES (
      'fee_structure', NEW.id, 'fee_structure_created', auth.uid(),
      jsonb_build_object(
        'title', NEW.title,
        'education_level', NEW.education_level,
        'level_number', NEW.level_number,
        'term', NEW.term,
        'academic_year', NEW.academic_year,
        'amount_kobo', NEW.amount_kobo
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.amount_kobo IS DISTINCT FROM OLD.amount_kobo THEN
      INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
      VALUES (
        'fee_structure', NEW.id, 'fee_structure_amount_changed', auth.uid(),
        jsonb_build_object(
          'title', NEW.title,
          'old_amount_kobo', OLD.amount_kobo,
          'new_amount_kobo', NEW.amount_kobo
        )
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    VALUES (
      'fee_structure', OLD.id, 'fee_structure_deleted', auth.uid(),
      jsonb_build_object('title', OLD.title, 'amount_kobo', OLD.amount_kobo)
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

create or replace function public.log_invoice_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    VALUES (
      'invoice', NEW.id, 'invoice_created', auth.uid(),
      jsonb_build_object(
        'student_id', NEW.student_id,
        'fee_structure_id', NEW.fee_structure_id,
        'transport_fee_structure_id', NEW.transport_fee_structure_id,
        'term', NEW.term,
        'academic_year', NEW.academic_year,
        'total_amount_kobo', NEW.total_amount_kobo,
        'discount_kobo', NEW.discount_kobo
      )
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.discount_kobo IS DISTINCT FROM OLD.discount_kobo
       OR NEW.total_amount_kobo IS DISTINCT FROM OLD.total_amount_kobo THEN
      INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
      VALUES (
        'invoice', NEW.id, 'invoice_amount_changed', auth.uid(),
        jsonb_build_object(
          'student_id', NEW.student_id,
          'old_total_amount_kobo', OLD.total_amount_kobo,
          'new_total_amount_kobo', NEW.total_amount_kobo,
          'old_discount_kobo', OLD.discount_kobo,
          'new_discount_kobo', NEW.discount_kobo
        )
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, metadata)
    VALUES (
      'invoice', OLD.id, 'invoice_deleted', auth.uid(),
      jsonb_build_object(
        'student_id', OLD.student_id,
        'total_amount_kobo', OLD.total_amount_kobo,
        'amount_paid_kobo', OLD.amount_paid_kobo
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

create or replace function public.protect_teacher_profile_staff_role()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
    IF new.staff_role IS DISTINCT FROM old.staff_role THEN
      RAISE EXCEPTION 'Changing staff_role is not permitted.';
    END IF;
  END IF;
  RETURN new;
END;
$function$;

create or replace function public.replace_quiz_questions(p_quiz_id uuid, p_questions jsonb)
 returns void
 language plpgsql
as $function$
declare
  v_quiz quizzes%rowtype;
  v_total numeric;
  v_question jsonb;
  v_option jsonb;
  v_question_id uuid;
  v_q_index int := 0;
  v_o_index int;
begin
  select * into v_quiz from quizzes where id = p_quiz_id for update;
  if not found then
    raise exception 'Quiz not found.';
  end if;
  if v_quiz.is_published then
    raise exception 'Unpublish this quiz before editing its questions.';
  end if;
  if exists (select 1 from quiz_attempts where quiz_id = p_quiz_id) then
    raise exception 'This quiz already has student attempts, so its questions can''t be changed.';
  end if;
  if jsonb_array_length(coalesce(p_questions, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one question.';
  end if;

  select coalesce(sum((q->>'points')::numeric), 0) into v_total
  from jsonb_array_elements(p_questions) as q;

  delete from quiz_options where question_id in (select id from quiz_questions where quiz_id = p_quiz_id);
  delete from quiz_questions where quiz_id = p_quiz_id;

  for v_question in select * from jsonb_array_elements(p_questions)
  loop
    v_q_index := v_q_index + 1;

    insert into quiz_questions (quiz_id, question_text, question_type, points, sequence_order)
    values (
      p_quiz_id,
      v_question->>'question_text',
      v_question->>'question_type',
      (v_question->>'points')::numeric,
      v_q_index
    )
    returning id into v_question_id;

    v_o_index := 0;
    for v_option in select * from jsonb_array_elements(coalesce(v_question->'options', '[]'::jsonb))
    loop
      v_o_index := v_o_index + 1;
      insert into quiz_options (question_id, option_text, match_prompt, is_correct, sequence_order)
      values (
        v_question_id,
        v_option->>'text',
        v_option->>'match_prompt',
        (v_option->>'is_correct')::boolean,
        v_o_index
      );
    end loop;
  end loop;

  update assessments set max_score = v_total where id = v_quiz.assessment_id;
end;
$function$;

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

create or replace function public.search_topic_notes(p_query text, p_limit integer default 20)
 returns table(note_id uuid, topic_id uuid, topic_title text, subject_name text, snippet text, rank real)
 language sql
 stable
 set search_path to 'public'
as $function$
  with q as (
    select
      case
        when p_query ~ '"' or p_query ~ '(^|\s)-\S' or p_query ~* '\sor\s'
          then websearch_to_tsquery('english', p_query)
        else coalesce(
          (
            select to_tsquery('english', string_agg(quote_literal(tok) || ':*', ' & '))
            from regexp_split_to_table(lower(p_query), '[^[:alnum:]]+') as tok
            where tok <> ''
          ),
          websearch_to_tsquery('english', p_query)
        )
      end as tsq
  )
  select
    n.id,
    n.topic_id,
    t.title,
    s.name,
    ts_headline(
      'english', n.content, q.tsq,
      'MaxFragments=1, MaxWords=25, MinWords=10, StartSel=' || chr(1) || ', StopSel=' || chr(2)
    ),
    ts_rank(n.content_search, q.tsq)
  from q, topic_notes n
  left join curriculum_topics t on t.id = n.topic_id
  left join subjects s on s.id = t.subject_id
  where n.content_search @@ q.tsq
  order by ts_rank(n.content_search, q.tsq) desc
  limit greatest(least(p_limit, 50), 1);
$function$;

create or replace function public.sync_student_class_from_enrollment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_current_year text;
  v_current_term integer;
BEGIN
  SELECT current_academic_year, current_term
    INTO v_current_year, v_current_term
    FROM school_settings
    WHERE id = 1;

  -- Only the enrollment for the *current* term should drive the cached
  -- class_id — don't let a backfilled/historical enrollment overwrite it.
  IF new.academic_year = v_current_year AND new.term = v_current_term THEN
    UPDATE student_profiles
       SET class_id = new.class_id
       WHERE id = new.student_id
         AND class_id IS DISTINCT FROM new.class_id;
  END IF;

  RETURN new;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 5. Function grants
--    record_invoice_payment and log_receipt_print write payments/audit rows
--    as SECURITY DEFINER and are callable only by the service role on live;
--    custom_access_token_hook only by the auth service. Left at Supabase's
--    defaults they would be executable by anon and authenticated users.
-- ----------------------------------------------------------------------------

revoke execute on function public.record_invoice_payment(uuid, bigint, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_invoice_payment(uuid, bigint, text, text, uuid, boolean) to service_role;

revoke execute on function public.log_receipt_print(uuid, boolean) from public, anon, authenticated;
grant execute on function public.log_receipt_print(uuid, boolean) to service_role;

revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ----------------------------------------------------------------------------
-- 6. Constraints
-- ----------------------------------------------------------------------------

-- 6a. Foreign keys that exist here without their ON DELETE rule
select pg_temp.ensure_constraint('conversation_archives', 'conversation_archives_partner_id_fkey', $c$FOREIGN KEY (partner_id) REFERENCES profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('conversation_archives', 'conversation_archives_user_id_fkey', $c$FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('curriculum_topics', 'curriculum_topics_subject_id_fkey', $c$FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('enrollments', 'enrollments_class_id_fkey', $c$FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('enrollments', 'enrollments_student_id_fkey', $c$FOREIGN KEY (student_id) REFERENCES student_profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('grades', 'grades_assessment_id_fkey', $c$FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('grades', 'grades_student_id_fkey', $c$FOREIGN KEY (student_id) REFERENCES student_profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('guardian_links', 'guardian_links_parent_id_fkey', $c$FOREIGN KEY (parent_id) REFERENCES profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('guardian_links', 'guardian_links_student_id_fkey', $c$FOREIGN KEY (student_id) REFERENCES student_profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('invoices', 'invoices_student_id_fkey', $c$FOREIGN KEY (student_id) REFERENCES student_profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('payments', 'payments_invoice_id_fkey', $c$FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('profile_contacts', 'profile_contacts_id_fkey', $c$FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('report_card_remarks', 'report_card_remarks_student_id_fkey', $c$FOREIGN KEY (student_id) REFERENCES student_profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('student_notes', 'student_notes_student_id_fkey', $c$FOREIGN KEY (student_id) REFERENCES student_profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('timetable_entries', 'timetable_entries_class_id_fkey', $c$FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('topic_notes', 'topic_notes_topic_id_fkey', $c$FOREIGN KEY (topic_id) REFERENCES curriculum_topics(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('topic_resources', 'topic_resources_note_id_fkey', $c$FOREIGN KEY (note_id) REFERENCES topic_notes(id) ON DELETE SET NULL$c$);
select pg_temp.ensure_constraint('topic_resources', 'topic_resources_topic_id_fkey', $c$FOREIGN KEY (topic_id) REFERENCES curriculum_topics(id) ON DELETE CASCADE$c$);

-- 6b. Foreign keys that were never created here
select pg_temp.ensure_constraint('profiles', 'profiles_id_fkey', $c$FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('student_profiles', 'student_profiles_id_fkey', $c$FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('teacher_profiles', 'teacher_profiles_id_fkey', $c$FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE$c$);
select pg_temp.ensure_constraint('vehicles', 'vehicles_driver_profile_id_fkey', $c$FOREIGN KEY (driver_profile_id) REFERENCES profiles(id)$c$);

-- 6c. Check constraints
select pg_temp.ensure_constraint('announcements', 'announcements_audience_check', $c$CHECK ((audience = ANY (ARRAY['all'::text, 'students'::text, 'teachers'::text, 'class'::text])))$c$);
select pg_temp.ensure_constraint('assessments', 'assessments_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('classes', 'classes_valid_level', $c$CHECK (valid_level_number(education_level, level_number))$c$);
select pg_temp.ensure_constraint('curriculum_topics', 'curriculum_topics_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('curriculum_topics', 'curriculum_topics_week_number_check', $c$CHECK (((week_number >= 1) AND (week_number <= 14)))$c$);
select pg_temp.ensure_constraint('curriculum_topics', 'topics_valid_level', $c$CHECK (valid_level_number(education_level, level_number))$c$);
select pg_temp.ensure_constraint('enrollments', 'enrollments_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('fee_structures', 'fee_structures_amount_kobo_check', $c$CHECK ((amount_kobo > 0))$c$);
select pg_temp.ensure_constraint('fee_structures', 'fee_structures_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('fee_structures', 'fee_structures_valid_level', $c$CHECK (valid_level_number(education_level, level_number))$c$);
select pg_temp.ensure_constraint('hostels', 'hostels_gender_check', $c$CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text])))$c$);
select pg_temp.ensure_constraint('invoices', 'invoices_amounts_non_negative', $c$CHECK (((total_amount_kobo >= 0) AND (discount_kobo >= 0) AND (amount_paid_kobo >= 0)))$c$);
select pg_temp.ensure_constraint('invoices', 'invoices_discount_not_exceeding_total', $c$CHECK ((discount_kobo <= total_amount_kobo))$c$);
select pg_temp.ensure_constraint('invoices', 'invoices_exactly_one_fee_structure', $c$CHECK ((num_nonnulls(fee_structure_id, transport_fee_structure_id, hostel_fee_structure_id) = 1))$c$);
select pg_temp.ensure_constraint('invoices', 'invoices_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('library_books', 'library_books_available_copies_check', $c$CHECK ((available_copies >= 0))$c$);
select pg_temp.ensure_constraint('library_books', 'library_books_copies_check', $c$CHECK ((available_copies <= total_copies))$c$);
select pg_temp.ensure_constraint('library_books', 'library_books_total_copies_check', $c$CHECK ((total_copies >= 0))$c$);
select pg_temp.ensure_constraint('payments', 'payments_amount_kobo_check', $c$CHECK ((amount_kobo > 0))$c$);
select pg_temp.ensure_constraint('payments', 'payments_method_check', $c$CHECK ((method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'card'::text, 'other'::text])))$c$);
select pg_temp.ensure_constraint('report_card_remarks', 'report_card_remarks_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('school_settings', 'school_settings_current_term_check', $c$CHECK ((current_term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('school_settings', 'single_row', $c$CHECK ((id = 1))$c$);
select pg_temp.ensure_constraint('student_profiles', 'student_profiles_gender_check', $c$CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text])))$c$);
select pg_temp.ensure_constraint('subjects', 'subjects_valid_max_level', $c$CHECK (valid_level_number(education_level, max_level_number))$c$);
select pg_temp.ensure_constraint('subjects', 'subjects_valid_min_level', $c$CHECK (valid_level_number(education_level, min_level_number))$c$);
select pg_temp.ensure_constraint('timetable_entries', 'timetable_entries_period_positive', $c$CHECK ((period_number > 0))$c$);
select pg_temp.ensure_constraint('timetable_entries', 'timetable_entries_term_check', $c$CHECK ((term = ANY (ARRAY[1, 2, 3])))$c$);
select pg_temp.ensure_constraint('timetable_entries', 'timetable_entries_weekday_check', $c$CHECK (((weekday >= 1) AND (weekday <= 7)))$c$);
select pg_temp.ensure_constraint('topic_resources', 'topic_resources_resource_type_check', $c$CHECK ((resource_type = ANY (ARRAY['image'::text, 'diagram_mermaid'::text, 'video'::text, 'pdf'::text, 'link'::text, 'audio'::text])))$c$);
select pg_temp.ensure_constraint('transport_locations', 'transport_locations_direction_check', $c$CHECK ((direction = ANY (ARRAY['morning'::text, 'afternoon'::text])))$c$);
select pg_temp.ensure_constraint('transport_trip_status', 'transport_trip_status_direction_check', $c$CHECK ((direction = ANY (ARRAY['morning'::text, 'afternoon'::text])))$c$);
select pg_temp.ensure_constraint('transport_trip_status', 'transport_trip_status_status_check', $c$CHECK ((status = ANY (ARRAY['not_started'::text, 'en_route'::text, 'arrived'::text])))$c$);

-- 6d. Unique constraints (the live project holds these as constraints, not
--     bare unique indexes)
select pg_temp.ensure_constraint('curriculum_topics', 'curriculum_topics_unique_sequence', $c$UNIQUE (subject_id, education_level, level_number, term, sequence_order)$c$);
select pg_temp.ensure_constraint('curriculum_topics', 'curriculum_topics_unique_week', $c$UNIQUE (subject_id, education_level, level_number, term, academic_year, week_number)$c$);
select pg_temp.ensure_constraint('enrollments', 'enrollments_student_id_class_id_academic_year_term_key', $c$UNIQUE (student_id, class_id, academic_year, term)$c$);
select pg_temp.ensure_constraint('enrollments', 'enrollments_unique_student_term', $c$UNIQUE (student_id, academic_year, term)$c$);
select pg_temp.ensure_constraint('grades', 'grades_assessment_id_student_id_key', $c$UNIQUE (assessment_id, student_id)$c$);
select pg_temp.ensure_constraint('guardian_links', 'guardian_links_unique_parent_student', $c$UNIQUE (parent_id, student_id)$c$);
select pg_temp.ensure_constraint('hostel_rooms', 'hostel_rooms_hostel_id_room_number_key', $c$UNIQUE (hostel_id, room_number)$c$);
select pg_temp.ensure_constraint('invoices', 'invoices_student_id_fee_structure_id_key', $c$UNIQUE (student_id, fee_structure_id)$c$);
select pg_temp.ensure_constraint('quiz_attempts', 'quiz_attempts_quiz_id_student_id_key', $c$UNIQUE (quiz_id, student_id)$c$);
select pg_temp.ensure_constraint('quiz_options', 'quiz_options_question_id_sequence_order_key', $c$UNIQUE (question_id, sequence_order)$c$);
select pg_temp.ensure_constraint('quiz_questions', 'quiz_questions_quiz_id_sequence_order_key', $c$UNIQUE (quiz_id, sequence_order)$c$);
select pg_temp.ensure_constraint('quizzes', 'quizzes_assessment_id_key', $c$UNIQUE (assessment_id)$c$);
select pg_temp.ensure_constraint('student_profiles', 'student_profiles_admission_no_key', $c$UNIQUE (admission_no)$c$);
select pg_temp.ensure_constraint('subjects', 'subjects_code_key', $c$UNIQUE (code)$c$);
select pg_temp.ensure_constraint('teacher_profiles', 'teacher_profiles_staff_id_key', $c$UNIQUE (staff_id)$c$);
select pg_temp.ensure_constraint('transport_stops', 'transport_stops_route_id_sequence_order_key', $c$UNIQUE (route_id, sequence_order)$c$);
select pg_temp.ensure_constraint('transport_trip_status', 'transport_trip_status_route_id_trip_date_direction_key', $c$UNIQUE (route_id, trip_date, direction)$c$);

-- ----------------------------------------------------------------------------
-- 7. grades score-bounds trigger (live fires on score / assessment_id only)
-- ----------------------------------------------------------------------------

do $$
begin
  if coalesce((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_check_grade_score_bounds' and tgrelid = 'public.grades'::regclass), '')
     <> 'CREATE TRIGGER trg_check_grade_score_bounds BEFORE INSERT OR UPDATE OF score, assessment_id ON public.grades FOR EACH ROW EXECUTE FUNCTION check_grade_score_bounds()' then
    drop trigger if exists trg_check_grade_score_bounds on public.grades;
    create trigger trg_check_grade_score_bounds
      before insert or update of score, assessment_id on public.grades
      for each row execute function check_grade_score_bounds();
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 8. Grants, event trigger, realtime publication, storage
-- ----------------------------------------------------------------------------

-- Supabase Auth reads profiles to build the access-token claims
-- (custom_access_token_hook); the RLS policy for it already exists.
grant select on table public.profiles to supabase_auth_admin;

-- New tables in `public` get RLS enabled automatically (the function
-- already exists above; live has the trigger that calls it).
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end
$$;

-- TransportStatusBadge / RouteMap subscribe to transport_trip_status.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'transport_trip_status') then
    alter publication supabase_realtime add table public.transport_trip_status;
  end if;
end
$$;

-- Storage policies for the student-photos bucket (the app creates the bucket
-- itself on first upload, see lib/actions/admin.ts).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'student_photos_select') then
    create policy student_photos_select on storage.objects for select to public
      using (
        bucket_id = 'student-photos'
        and (
          is_admin()
          or exists (select 1 from teacher_profiles where teacher_profiles.id = auth.uid())
          or is_self_student(((storage.foldername(name))[1])::uuid)
          or is_parent_of(((storage.foldername(name))[1])::uuid)
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'student_photos_insert') then
    create policy student_photos_insert on storage.objects for insert to public
      with check (
        bucket_id = 'student-photos'
        and (is_admin() or exists (select 1 from teacher_profiles where teacher_profiles.id = auth.uid()))
        and ((metadata ->> 'size')::bigint) <= 5242880
        and (metadata ->> 'mimetype') = any (array['image/jpeg', 'image/png', 'image/webp'])
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'student_photos_delete') then
    create policy student_photos_delete on storage.objects for delete to public
      using (bucket_id = 'student-photos' and is_admin());
  end if;
end
$$;

-- The topic-resources bucket. The app also creates it on first use and
-- ignores "already exists" (lib/actions/teacher.ts), the same arrangement as
-- the homework-submissions bucket, so this is optional and idempotent.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'topic-resources',
  'topic-resources',
  false,
  20971520, -- 20 MB
  array['image/jpeg','image/png','image/webp','application/pdf','audio/mpeg','audio/wav','audio/ogg','video/mp4','video/webm']
)
on conflict (id) do nothing;
