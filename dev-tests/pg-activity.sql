select pid, state, wait_event_type, query
from pg_stat_activity
where datname = 'dify' and state = 'active'
order by query_start;
