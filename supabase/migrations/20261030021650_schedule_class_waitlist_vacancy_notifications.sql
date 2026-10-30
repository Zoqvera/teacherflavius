-- Check availability once a minute and send one deduplicated email per increase.
select cron.schedule(
  'class-waitlist-vacancy-email-every-minute',
  '* * * * *',
  'select private.run_class_waitlist_vacancy_monitor();'
);