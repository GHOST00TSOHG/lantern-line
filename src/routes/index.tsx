import { createFileRoute } from "@tanstack/react-router";
import { WardApp } from "@/components/city/WardApp";

export const Route = createFileRoute("/")({ component: WardApp });
