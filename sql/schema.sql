create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  password_hash text not null,
  nickname text not null default '跑者',
  quota int not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists run_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  version int not null,
  images jsonb not null default '[]',
  user_text text not null default '',
  goal text not null default 'none',
  race_date date,
  recognition jsonb,
  diagnosis jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (user_id, version)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  record_id uuid references run_records(id) on delete set null,
  amount numeric(10,2) not null default 9.90,
  status text not null default 'unpaid',
  created_at timestamptz not null default now()
);

-- 意见反馈（2026-09-19 新增）：前端"💬 反馈"入口写入，管理员在 Table Editor 查看
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  content text not null,
  contact text,
  created_at timestamptz not null default now()
);

alter table users enable row level security;
alter table run_records enable row level security;
alter table orders enable row level security;

-- 密保问题找回：答案只存 bcrypt 哈希
alter table users add column if not exists security_question text;
alter table users add column if not exists security_answer_hash text;

-- 2026-09-17 迁移：列表页冗余字段，避免每次拉取并解析整个 diagnosis JSON
-- 已建库的项目直接重跑本文件即可（add column if not exists 幂等）
alter table run_records add column if not exists summary text;
alter table run_records add column if not exists risk_level text;
alter table run_records add column if not exists goal_type text;

-- 旧数据回填（新字段优先从已存的 diagnosis 里取）
update run_records set summary = diagnosis->>'summary' where summary is null and diagnosis is not null;
update run_records set goal_type = goal where goal_type is null;

-- 2026-09-19 迁移：常用查询路径补索引（列表页按时间倒序、历史取数按用户+状态）
create index if not exists idx_run_records_user_created on run_records (user_id, created_at desc);
create index if not exists idx_run_records_user_status on run_records (user_id, status);
create index if not exists idx_orders_user on orders (user_id);

-- 2026-09-19 迁移：补 (user_id, version) 唯一约束。
-- 早期建库若用的是无约束版 schema，create table if not exists 不会补上它，
-- 会导致并发/重复提交出现两条"第 1 次诊断"。老库请重跑本文件补齐。
-- 若报唯一冲突，说明库里已有重复 version，先执行下面的清理（每个 user_id+version 只留最新一条）：
--   delete from run_records a using run_records b
--     where a.user_id = b.user_id and a.version = b.version and a.created_at < b.created_at;
create unique index if not exists uniq_run_records_user_version on run_records (user_id, version);

-- 2026-10-08 新增：同意留痕（PIPL 第 55-56 条处理记录要求）。
-- 每次注册勾选（协议/出境/年龄）与每次诊断的健康数据单独同意都写一条，
-- 带政策版本号与时间戳，核查时可举证"谁在何时同意了哪一版"。
-- user_id 用 on delete set null + 冗余 phone：账号注销后同意记录保留作合规证据，
-- 但只留手机号归属线索，不留其他个人信息。
create table if not exists user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  phone text,
  consent_type text not null,      -- register_terms=注册协议 cross_border=出境单独同意 age_self=年龄声明 health_data=健康数据
  policy_version text not null,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_consents_user on user_consents (user_id, created_at desc);
create index if not exists idx_user_consents_phone on user_consents (phone);
alter table user_consents enable row level security;
