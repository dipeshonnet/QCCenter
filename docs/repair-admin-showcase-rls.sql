-- Run in the Supabase SQL Editor as the project database administrator.
-- Backend-only access for user administration and synthetic showcase data.
-- Does not touch auth/storage schemas or grant access to anon/authenticated.
BEGIN;
GRANT USAGE ON SCHEMA public TO qcc_app;
DO $repair$
DECLARE
    target_table text;
    identity_sequence text;
BEGIN
    FOREACH target_table IN ARRAY ARRAY[
        'users', 'user_profiles', 'user_roles', 'sessions', 'audit_events',
        'accounts', 'account_config', 'processes', 'process_settings',
        'scorecard_versions', 'scorecard_items', 'audit_cases',
        'audit_responses', 'audit_defects', 'capas', 'capa_events', 'app_settings'
    ] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO qcc_app', target_table);
        IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = target_table
              AND policyname = 'qcc_app_admin_showcase_access'
        ) THEN
            EXECUTE format(
                'CREATE POLICY qcc_app_admin_showcase_access ON public.%I FOR ALL TO qcc_app USING (true) WITH CHECK (true)',
                target_table
            );
        END IF;
        FOR identity_sequence IN
            SELECT pg_get_serial_sequence(format('public.%I', target_table), column_name)
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = target_table
              AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')
        LOOP
            IF identity_sequence IS NOT NULL THEN
                EXECUTE format('GRANT USAGE ON SEQUENCE %s TO qcc_app', identity_sequence);
            END IF;
        END LOOP;
    END LOOP;
END
$repair$;
COMMIT;
