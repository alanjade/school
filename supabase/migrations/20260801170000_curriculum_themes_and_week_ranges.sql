-- Curriculum topics currently model one topic per week (week_number, no
-- grouping). NERDC's actual scheme-of-work structure (studyzone.ng,
-- nerdc.org.ng/CurriculumView.aspx) groups several topics under a shared
-- Theme (e.g. "Number and Numeration"), and a single topic commonly spans
-- more than one week (e.g. weeks 2-3). This migration adds both:
--   - theme: free-text grouping label, nullable (existing rows have none)
--   - week_end_number: end of the topic's week range; backfilled to equal
--     week_number for existing rows (so they read as a single-week span,
--     same as before), then constrained >= week_number going forward.
-- week_number itself keeps its existing meaning (start of the range) so no
-- other query or type that already reads it needs to change.

alter table curriculum_topics
  add column theme text,
  add column week_end_number integer;

update curriculum_topics
  set week_end_number = week_number
  where week_end_number is null;

alter table curriculum_topics
  alter column week_end_number set not null,
  add constraint curriculum_topics_week_range_check check (week_end_number >= week_number);

comment on column curriculum_topics.theme is
  'Optional grouping label matching NERDC scheme-of-work themes (e.g. "Number and Numeration"). Several topics can share a theme.';
comment on column curriculum_topics.week_end_number is
  'Last week this topic covers. Equal to week_number for a single-week topic.';
