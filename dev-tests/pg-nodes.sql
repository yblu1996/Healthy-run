select node_type, title, status, left(coalesce(error,'-'),120) as err, created_at, elapsed_time
from workflow_node_executions
where workflow_run_id = '7ee43617-071e-4c88-948b-cfe2a3074768'
order by index;

select status, updated_at, created_at from workflow_runs where id = '7ee43617-071e-4c88-948b-cfe2a3074768';
