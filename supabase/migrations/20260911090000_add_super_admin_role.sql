-- Enum values must be committed before they can be used by subsequent migrations.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin' BEFORE 'admin';
