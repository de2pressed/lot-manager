-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  role text not null default 'viewer' check (role in ('admin', 'manager', 'ops', 'viewer')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- Products (unified Shopify catalog cache)
create table public.products (
  id uuid primary key default uuid_generate_v4(),
  shopify_product_id bigint unique,
  title text not null,
  image_url text,
  variants jsonb not null default '[]',
  created_at timestamptz default now(),
  synced_at timestamptz,
  updated_at timestamptz default now()
);

-- Lots
create table public.lots (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  max_items integer not null default 100,
  status text not null default 'open' check (status in ('open', 'full', 'pushed')),
  pushed_at timestamptz,
  pushed_by uuid references auth.users(id),
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lot items
create table public.lot_items (
  id uuid primary key default uuid_generate_v4(),
  lot_id uuid references public.lots(id) on delete cascade not null,
  product_id uuid references public.products(id) not null,
  shopify_product_id bigint,
  product_title text not null,
  variant_title text not null,
  variant_id text,
  color text,
  size text,
  sku text,
  qty integer not null default 1 check (qty > 0),
  buy_price numeric(10,2),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Inventory
create table public.inventory (
  id uuid primary key default uuid_generate_v4(),
  lot_id uuid references public.lots(id),
  lot_item_id uuid references public.lot_items(id),
  product_id uuid references public.products(id),
  shopify_product_id bigint,
  product_title text not null,
  variant_title text not null,
  color text,
  size text,
  sku text,
  buy_price numeric(10,2) not null default 0,
  quantity integer not null default 0,
  status text not null default 'in_stock' check (status in ('in_stock', 'low_stock', 'sold_out')),
  notes text,
  date_added timestamptz default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz default now()
);

-- Sales
create table public.sales (
  id uuid primary key default uuid_generate_v4(),
  inventory_id uuid references public.inventory(id),
  product_id uuid references public.products(id),
  shopify_product_id bigint,
  product_title text not null,
  variant_title text not null,
  buy_price numeric(10,2) not null,
  sale_price numeric(10,2) not null,
  profit numeric(10,2) generated always as (sale_price - buy_price) stored,
  qty_sold integer not null default 1 check (qty_sold > 0),
  platform text default 'Direct' check (
    platform in ('Direct', 'Instagram DM', 'WhatsApp', 'Depop', 'Other')
  ),
  date_sold timestamptz default now(),
  notes text,
  created_by uuid references auth.users(id)
);

-- Activity log
create table public.activity_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  username text,
  type text not null,
  description text not null,
  amount numeric(10,2),
  ref_id uuid,
  ref_type text,
  created_at timestamptz default now()
);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger products_updated_at before update on public.products
  for each row execute function update_updated_at();
create trigger lots_updated_at before update on public.lots
  for each row execute function update_updated_at();
create trigger lot_items_updated_at before update on public.lot_items
  for each row execute function update_updated_at();
create trigger inventory_updated_at before update on public.inventory
  for each row execute function update_updated_at();

create or replace function update_lot_status()
returns trigger as $$
declare
  target_lot_id uuid;
  total_qty integer;
  max_cap integer;
begin
  target_lot_id := coalesce(new.lot_id, old.lot_id);

  select coalesce(sum(qty), 0) into total_qty from public.lot_items where lot_id = target_lot_id;
  select max_items into max_cap from public.lots where id = target_lot_id;

  if total_qty >= max_cap then
    update public.lots set status = 'full' where id = target_lot_id and status = 'open';
  elsif exists(select 1 from public.lots where id = target_lot_id and status = 'full') then
    update public.lots set status = 'open' where id = target_lot_id;
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger lot_items_capacity after insert or update or delete on public.lot_items
  for each row execute function update_lot_status();

create or replace function update_inventory_status()
returns trigger as $$
begin
  if new.quantity <= 0 then
    new.status := 'sold_out';
  elsif new.quantity <= 3 then
    new.status := 'low_stock';
  else
    new.status := 'in_stock';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger inventory_status_update before insert or update on public.inventory
  for each row execute function update_inventory_status();

create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, role)
  values (new.id, new.email, 'viewer');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.lots enable row level security;
alter table public.lot_items enable row level security;
alter table public.inventory enable row level security;
alter table public.sales enable row level security;
alter table public.activity_log enable row level security;

create or replace function get_my_role()
returns text as $$
  select role from public.profiles where id = auth.uid();
$$ language sql security definer stable;

create policy "profiles_read_all" on public.profiles
  for select using (auth.role() = 'authenticated');
create policy "profiles_admin_write" on public.profiles
  for all using (get_my_role() = 'admin');

create policy "products_read" on public.products
  for select using (auth.role() = 'authenticated');
create policy "products_write" on public.products
  for all using (get_my_role() in ('admin', 'manager'));

create policy "lots_read" on public.lots
  for select using (auth.role() = 'authenticated');
create policy "lots_write" on public.lots
  for all using (get_my_role() in ('admin', 'manager', 'ops'));

create policy "lot_items_read" on public.lot_items
  for select using (auth.role() = 'authenticated');
create policy "lot_items_write" on public.lot_items
  for all using (get_my_role() in ('admin', 'manager', 'ops'));

create policy "inventory_read" on public.inventory
  for select using (auth.role() = 'authenticated');
create policy "inventory_write" on public.inventory
  for all using (get_my_role() in ('admin', 'manager'));

create policy "sales_read" on public.sales
  for select using (auth.role() = 'authenticated');
create policy "sales_write" on public.sales
  for all using (get_my_role() in ('admin', 'manager'));

create policy "log_read" on public.activity_log
  for select using (auth.role() = 'authenticated');
create policy "log_insert" on public.activity_log
  for insert with check (auth.role() = 'authenticated');
