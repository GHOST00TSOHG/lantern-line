import { createFileRoute } from "@tanstack/react-router";
import { authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink p-6 text-fg">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-4">
        <h1 className="font-display text-xl leading-tight font-medium">Lantern Line</h1>
        <p className="mt-2 mb-4 text-sm text-muted">Continue with Google. This does not use an X account. Sheets and Drive stay available.</p>
        {authEnabled ? (
          <button
            type="button"
            onClick={() => {
              const code = new URLSearchParams(window.location.search).get("with");
              signIn("grok-google", { callbackURL: code ? `/?with=${encodeURIComponent(code)}` : "/" });
            }}
            className="h-11 w-full rounded-md bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            Continue with Google
          </button>
        ) : (
          <p className="text-sm text-muted">Sign-in is disabled.</p>
        )}
      </div>
    </main>
  );
}
