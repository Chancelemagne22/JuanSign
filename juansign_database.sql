-- public.signs definition

-- Drop table

-- DROP TABLE public.signs;

CREATE TABLE public.signs (
	sign_id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	category text NOT NULL,
	video_url text NOT NULL,
	created_at timestamp DEFAULT now() NULL,
	CONSTRAINT signs_name_key UNIQUE (name),
	CONSTRAINT signs_pkey PRIMARY KEY (sign_id)
);
ALTER TABLE public.signs ENABLE ROW LEVEL SECURITY;


-- public.levels definition

-- Drop table

-- DROP TABLE public.levels;

CREATE TABLE public.levels (
	level_id uuid DEFAULT gen_random_uuid() NOT NULL,
	level_name varchar(255) NOT NULL,
	sequence_order int2 NOT NULL,
	previous_level_id uuid NULL,
	passing_score int2 DEFAULT 75 NOT NULL,
	created_at timestamptz DEFAULT now() NULL,
	level_order int4 DEFAULT 0 NULL,
	category text NULL,
	CONSTRAINT levels_pkey PRIMARY KEY (level_id),
	CONSTRAINT levels_sequence_order_key UNIQUE (sequence_order),
	CONSTRAINT levels_previous_level_id_fkey FOREIGN KEY (previous_level_id) REFERENCES public.levels(level_id) ON DELETE SET NULL
);
ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Allow authenticated users to read levels" ON public.levels
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);
CREATE POLICY "Authenticated users read levels" ON public.levels
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);


-- public.practice_questions definition

-- Drop table

-- DROP TABLE public.practice_questions;

CREATE TABLE public.practice_questions (
	question_id uuid DEFAULT gen_random_uuid() NOT NULL,
	level_id uuid NOT NULL,
	question_text text NOT NULL,
	target_sign text NULL,
	reference_data text NULL,
	created_at timestamptz DEFAULT now() NULL,
	option_a text NULL,
	option_b text NULL,
	option_c text NULL,
	option_d text NULL,
	correct_answer varchar NULL,
	question_type varchar DEFAULT 'identify'::character varying NOT NULL,
	video_url text NULL,
	question_order int4 NULL,
	CONSTRAINT practice_questions_pkey PRIMARY KEY (question_id),
	CONSTRAINT practice_questions_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(level_id) ON DELETE CASCADE
);
CREATE INDEX idx_practice_questions_level_question_order ON public.practice_questions USING btree (level_id, question_order);
ALTER TABLE public.practice_questions ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Authenticated users read practice questions" ON public.practice_questions
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);
CREATE POLICY "Students can read practice questions" ON public.practice_questions
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);


-- public.assessment_questions definition

-- Drop table

-- DROP TABLE public.assessment_questions;

CREATE TABLE public.assessment_questions (
	question_id uuid DEFAULT gen_random_uuid() NOT NULL,
	level_id uuid NOT NULL,
	question_text text NOT NULL,
	correct_sign text NULL,
	points int2 DEFAULT 1 NOT NULL,
	created_at timestamptz DEFAULT now() NULL,
	option_a text NULL,
	option_b text NULL,
	option_c text NULL,
	option_d text NULL,
	correct_answer varchar NULL,
	question_type varchar DEFAULT 'identify'::character varying NOT NULL,
	video_url text NULL,
	question_order int4 NULL,
	CONSTRAINT assessment_questions_pkey PRIMARY KEY (question_id),
	CONSTRAINT assessment_questions_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(level_id) ON DELETE CASCADE
);
CREATE INDEX idx_assessment_questions_level_question_order ON public.assessment_questions USING btree (level_id, question_order);
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Authenticated users read assessment questions" ON public.assessment_questions
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);
CREATE POLICY "Students can read assessment questions" ON public.assessment_questions
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);


-- public.lessons definition

-- Drop table

-- DROP TABLE public.lessons;

CREATE TABLE public.lessons (
	lesson_id uuid DEFAULT gen_random_uuid() NOT NULL,
	level_id uuid NOT NULL,
	lesson_title varchar(255) NOT NULL,
	video_url text NULL,
	content_text text NULL,
	lesson_order int2 NOT NULL,
	created_at timestamptz DEFAULT now() NULL,
	lesson_title_tagalog varchar NULL,
	content_text_tagalog text NULL,
	CONSTRAINT lessons_level_id_lesson_order_key UNIQUE (level_id, lesson_order),
	CONSTRAINT lessons_pkey PRIMARY KEY (lesson_id),
	CONSTRAINT lessons_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(level_id) ON DELETE CASCADE
);
CREATE INDEX idx_lessons_level ON public.lessons USING btree (level_id, lesson_order);
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Allow authenticated users to read lessons" ON public.lessons
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);
CREATE POLICY "Authenticated users read lessons" ON public.lessons
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);
CREATE POLICY "Students can read lessons" ON public.lessons
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING (true);


-- public.admin_invites definition

-- Drop table

-- DROP TABLE public.admin_invites;

CREATE TABLE public.admin_invites (
	id uuid DEFAULT gen_random_uuid() NOT NULL,
	code text NOT NULL,
	is_used bool DEFAULT false NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	expires_at timestamptz NOT NULL,
	used_by_user_id uuid NULL,
	used_at timestamptz NULL,
	status text DEFAULT 'pending'::text NULL,
	email text NULL,
	invited_by uuid NULL,
	approved_by uuid NULL,
	approved_at timestamptz NULL,
	rejection_reason text NULL,
	CONSTRAINT admin_invites_code_key UNIQUE (code),
	CONSTRAINT admin_invites_pkey PRIMARY KEY (id),
	CONSTRAINT admin_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);
CREATE INDEX admin_invites_code_idx ON public.admin_invites USING btree (code);
CREATE INDEX admin_invites_is_used_idx ON public.admin_invites USING btree (is_used);
CREATE INDEX admin_invites_status_idx ON public.admin_invites USING btree (status);
ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Allow super_admin to approve invites" ON public.admin_invites
 AS PERMISSIVE
 FOR UPDATE
 USING ((auth.uid() IN ( SELECT admin_invites.id
   FROM profiles
  WHERE (profiles.role = 'super_admin'::text))))
 WITH CHECK ((auth.uid() IN ( SELECT admin_invites.id
   FROM profiles
  WHERE (profiles.role = 'super_admin'::text))));
CREATE POLICY "Allow super_admin to create admin_invites" ON public.admin_invites
 AS PERMISSIVE
 FOR INSERT
 WITH CHECK ((auth.uid() IN ( SELECT admin_invites.id
   FROM profiles
  WHERE (profiles.role = 'super_admin'::text))));
CREATE POLICY "Allow super_admin to view admin_invites" ON public.admin_invites
 AS PERMISSIVE
 FOR SELECT
 USING ((auth.uid() IN ( SELECT admin_invites.id
   FROM profiles
  WHERE (profiles.role = 'super_admin'::text))));
CREATE POLICY "Allow updating invite status via RPC" ON public.admin_invites
 AS PERMISSIVE
 FOR UPDATE
 USING (true)
 WITH CHECK (true);
CREATE POLICY "Allow viewing valid unused invites" ON public.admin_invites
 AS PERMISSIVE
 FOR SELECT
 USING (((is_used = false) AND (expires_at > now())));


-- public.assessment_results definition

-- Drop table

-- DROP TABLE public.assessment_results;

CREATE TABLE public.assessment_results (
	result_id uuid DEFAULT gen_random_uuid() NOT NULL,
	auth_user_id uuid NOT NULL,
	level_id uuid NOT NULL,
	score int2 NOT NULL,
	stars_earned int2 DEFAULT 0 NOT NULL,
	time_taken_seconds int4 NULL,
	is_passed bool DEFAULT false NOT NULL,
	attempt_date timestamptz DEFAULT now() NULL,
	CONSTRAINT assessment_results_pkey PRIMARY KEY (result_id),
	CONSTRAINT assessment_results_stars_earned_check CHECK (((stars_earned >= 0) AND (stars_earned <= 3)))
);
CREATE INDEX idx_assessment_results_user ON public.assessment_results USING btree (auth_user_id);
ALTER TABLE public.assessment_results ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Users manage own assessment results" ON public.assessment_results
 AS PERMISSIVE
 FOR ALL
 USING ((auth.uid() = auth_user_id));


-- public.lessons_viewed definition

-- Drop table

-- DROP TABLE public.lessons_viewed;

CREATE TABLE public.lessons_viewed (
	view_id uuid DEFAULT gen_random_uuid() NOT NULL,
	auth_user_id uuid NULL,
	lesson_id uuid NOT NULL,
	last_page_index int4 DEFAULT 0 NULL,
	viewed_at timestamptz DEFAULT now() NULL,
	CONSTRAINT lessons_viewed_auth_user_id_lesson_id_key UNIQUE (auth_user_id, lesson_id),
	CONSTRAINT lessons_viewed_pkey PRIMARY KEY (view_id)
);
ALTER TABLE public.lessons_viewed ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Users can insert own lessons_viewed" ON public.lessons_viewed
 AS PERMISSIVE
 FOR INSERT
 WITH CHECK ((auth.uid() = auth_user_id));
CREATE POLICY "Users can update own lessons_viewed" ON public.lessons_viewed
 AS PERMISSIVE
 FOR UPDATE
 USING ((auth.uid() = auth_user_id));
CREATE POLICY "Users can view own lessons_viewed" ON public.lessons_viewed
 AS PERMISSIVE
 FOR SELECT
 USING ((auth.uid() = auth_user_id));


-- public.practice_sessions definition

-- Drop table

-- DROP TABLE public.practice_sessions;

CREATE TABLE public.practice_sessions (
	session_id uuid DEFAULT gen_random_uuid() NOT NULL,
	auth_user_id uuid NOT NULL,
	level_id uuid NOT NULL,
	session_date timestamptz DEFAULT now() NULL,
	confidence numeric(5, 2) NULL,
	sign text NULL,
	target_sign text NULL,
	is_correct bool NULL,
	CONSTRAINT practice_sessions_pkey PRIMARY KEY (session_id)
);
CREATE INDEX idx_practice_sessions_user ON public.practice_sessions USING btree (auth_user_id);
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Users manage own sessions" ON public.practice_sessions
 AS PERMISSIVE
 FOR ALL
 USING ((auth.uid() = auth_user_id));


-- public.profiles definition

-- Drop table

-- DROP TABLE public.profiles;

CREATE TABLE public.profiles (
	profile_id uuid DEFAULT gen_random_uuid() NOT NULL,
	auth_user_id uuid NOT NULL,
	username varchar(60) NULL,
	first_name varchar(60) NULL,
	last_name varchar(60) NULL,
	is_active bool DEFAULT true NOT NULL,
	created_at timestamptz DEFAULT now() NULL,
	updated_at timestamptz DEFAULT now() NULL,
	avatar_url text NULL,
	last_seen timestamptz NULL,
	"role" text DEFAULT 'student'::text NULL,
	is_archived bool DEFAULT false NULL,
	archived_at timestamptz NULL,
	CONSTRAINT profiles_auth_user_id_key UNIQUE (auth_user_id),
	CONSTRAINT profiles_pkey PRIMARY KEY (profile_id),
	CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['student'::text, 'admin'::text, 'super_admin'::text]))),
	CONSTRAINT profiles_username_key UNIQUE (username)
);

-- Table Triggers

create trigger on_profile_created_unlock_level1 after
insert
    on
    public.profiles for each row execute function unlock_first_level();
create trigger profiles_updated_at before
update
    on
    public.profiles for each row execute function set_updated_at();
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Users can manage own profile" ON public.profiles
 AS PERMISSIVE
 FOR ALL
 USING ((auth.uid() = auth_user_id));
CREATE POLICY "Users can read own profile" ON public.profiles
 AS PERMISSIVE
 FOR SELECT
 USING ((auth.uid() = auth_user_id));
CREATE POLICY "Users read own profile" ON public.profiles
 AS PERMISSIVE
 FOR SELECT
 USING ((auth.uid() = auth_user_id));
CREATE POLICY "Users update own profile" ON public.profiles
 AS PERMISSIVE
 FOR UPDATE
 USING ((auth.uid() = auth_user_id));
CREATE POLICY allow_admin_access ON public.profiles
 AS PERMISSIVE
 FOR ALL
 TO authenticated
 USING (is_admin_v2());
CREATE POLICY allow_self_access ON public.profiles
 AS PERMISSIVE
 FOR ALL
 USING ((auth.uid() = auth_user_id));


-- public.user_progress definition

-- Drop table

-- DROP TABLE public.user_progress;

CREATE TABLE public.user_progress (
	progress_id uuid DEFAULT gen_random_uuid() NOT NULL,
	auth_user_id uuid NOT NULL,
	level_id uuid NOT NULL,
	is_unlocked bool DEFAULT false NOT NULL,
	lessons_completed int2 DEFAULT 0 NOT NULL,
	best_score int2 NULL,
	last_accessed timestamptz NULL,
	updated_at timestamptz DEFAULT now() NULL,
	CONSTRAINT user_progress_auth_user_id_level_id_key UNIQUE (auth_user_id, level_id),
	CONSTRAINT user_progress_pkey PRIMARY KEY (progress_id)
);
CREATE INDEX idx_user_progress_level ON public.user_progress USING btree (level_id);
CREATE INDEX idx_user_progress_user ON public.user_progress USING btree (auth_user_id);

-- Table Triggers

create trigger user_progress_updated_at before
update
    on
    public.user_progress for each row execute function set_updated_at();
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;

-- Table Policies

CREATE POLICY "Users can read own progress" ON public.user_progress
 AS PERMISSIVE
 FOR SELECT
 TO authenticated
 USING ((auth_user_id = auth.uid()));
CREATE POLICY "Users manage own progress" ON public.user_progress
 AS PERMISSIVE
 FOR ALL
 USING ((auth.uid() = auth_user_id));


-- public.admin_invites foreign keys

ALTER TABLE public.admin_invites ADD CONSTRAINT admin_invites_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.admin_invites ADD CONSTRAINT admin_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.admin_invites ADD CONSTRAINT admin_invites_used_by_user_id_fkey FOREIGN KEY (used_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


-- public.assessment_results foreign keys

ALTER TABLE public.assessment_results ADD CONSTRAINT assessment_results_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.assessment_results ADD CONSTRAINT assessment_results_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(level_id) ON DELETE CASCADE;


-- public.lessons_viewed foreign keys

ALTER TABLE public.lessons_viewed ADD CONSTRAINT lessons_viewed_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- public.practice_sessions foreign keys

ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(level_id) ON DELETE CASCADE;


-- public.profiles foreign keys

ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- public.user_progress foreign keys

ALTER TABLE public.user_progress ADD CONSTRAINT user_progress_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_progress ADD CONSTRAINT user_progress_level_id_fkey FOREIGN KEY (level_id) REFERENCES public.levels(level_id) ON DELETE CASCADE;