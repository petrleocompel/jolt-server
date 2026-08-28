CREATE TYPE "public"."device_platform" AS ENUM('ios');--> statement-breakpoint
CREATE TYPE "public"."friend_request_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."poke_delivery_status" AS ENUM('pending', 'fired', 'deviceNotConnected', 'notAllowed', 'muted');--> statement-breakpoint
CREATE TYPE "public"."stimulus_kind" AS ENUM('zap', 'vibe', 'beep');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" "device_platform" DEFAULT 'ios' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "device_token_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "friend_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"granter_id" text NOT NULL,
	"grantee_id" text NOT NULL,
	"kind" "stimulus_kind" NOT NULL,
	"is_allowed" boolean DEFAULT false NOT NULL,
	"max_intensity" integer DEFAULT 0 NOT NULL,
	"cooldown_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_permission_no_self" CHECK ("friend_permission"."granter_id" <> "friend_permission"."grantee_id"),
	CONSTRAINT "friend_permission_intensity_range" CHECK ("friend_permission"."max_intensity" >= 0 AND "friend_permission"."max_intensity" <= 100),
	CONSTRAINT "friend_permission_cooldown_positive" CHECK ("friend_permission"."cooldown_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "friend_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" text NOT NULL,
	"to_user_id" text NOT NULL,
	"status" "friend_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friend_request_no_self" CHECK ("friend_request"."from_user_id" <> "friend_request"."to_user_id")
);
--> statement-breakpoint
CREATE TABLE "friendship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_canonical_order" CHECK ("friendship"."user_a" < "friendship"."user_b")
);
--> statement-breakpoint
CREATE TABLE "poke_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" "stimulus_kind" NOT NULL,
	"intensity" integer NOT NULL,
	"repetitions" integer NOT NULL,
	"status" "poke_delivery_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_at" timestamp with time zone,
	CONSTRAINT "poke_event_intensity_range" CHECK ("poke_event"."intensity" >= 0 AND "poke_event"."intensity" <= 100),
	CONSTRAINT "poke_event_repetitions_range" CHECK ("poke_event"."repetitions" >= 1 AND "poke_event"."repetitions" <= 5)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handle" text NOT NULL,
	"invite_code" text NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_handle_unique" UNIQUE("handle"),
	CONSTRAINT "user_invite_code_unique" UNIQUE("invite_code"),
	CONSTRAINT "user_handle_format" CHECK ("user"."handle" ~ '^[a-z0-9_]{3,20}$')
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_token" ADD CONSTRAINT "device_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_permission" ADD CONSTRAINT "friend_permission_granter_id_user_id_fk" FOREIGN KEY ("granter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_permission" ADD CONSTRAINT "friend_permission_grantee_id_user_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_request" ADD CONSTRAINT "friend_request_from_user_id_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_request" ADD CONSTRAINT "friend_request_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_a_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship" ADD CONSTRAINT "friendship_user_b_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poke_event" ADD CONSTRAINT "poke_event_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poke_event" ADD CONSTRAINT "poke_event_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_token_user_idx" ON "device_token" USING btree ("user_id","disabled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_permission_key" ON "friend_permission" USING btree ("granter_id","grantee_id","kind");--> statement-breakpoint
CREATE INDEX "friend_permission_grantee_idx" ON "friend_permission" USING btree ("grantee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_request_pending_key" ON "friend_request" USING btree ("from_user_id","to_user_id") WHERE "friend_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_request_to_idx" ON "friend_request" USING btree ("to_user_id","status");--> statement-breakpoint
CREATE INDEX "friend_request_from_idx" ON "friend_request" USING btree ("from_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "friendship_pair_key" ON "friendship" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE INDEX "friendship_user_a_idx" ON "friendship" USING btree ("user_a");--> statement-breakpoint
CREATE INDEX "friendship_user_b_idx" ON "friendship" USING btree ("user_b");--> statement-breakpoint
CREATE INDEX "poke_event_recipient_idx" ON "poke_event" USING btree ("recipient_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "poke_event_sender_idx" ON "poke_event" USING btree ("sender_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "poke_event_cooldown_idx" ON "poke_event" USING btree ("sender_id","recipient_id","kind","created_at" DESC NULLS LAST);