CREATE TYPE "public"."push_transport" AS ENUM('apns', 'relay');--> statement-breakpoint
ALTER TYPE "public"."device_platform" ADD VALUE 'android';--> statement-breakpoint
ALTER TABLE "device_token" ADD COLUMN "transport" "push_transport" DEFAULT 'apns' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_token" ADD COLUMN "payload_key" text;--> statement-breakpoint
ALTER TABLE "device_token" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "device_token" ADD CONSTRAINT "device_token_relay_key" CHECK ("device_token"."transport" = 'apns' OR ("device_token"."payload_key" IS NOT NULL AND "device_token"."key_id" IS NOT NULL));