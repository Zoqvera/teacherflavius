create index if not exists student_class_reviews_reviewed_by_idx
  on private.student_class_reviews (reviewed_by)
  where reviewed_by is not null;
