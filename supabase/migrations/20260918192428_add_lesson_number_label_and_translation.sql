-- Adiciona o identificador editorial da lição e a tradução do exemplo.
-- O rótulo aceita texto e números e é independente da ordem técnica do roteiro.

alter table public.study_lesson_pages
  add column lesson_number_label text not null
    check (char_length(btrim(lesson_number_label)) between 1 and 50),
  add column translation text not null
    check (char_length(btrim(translation)) between 1 and 1000);
