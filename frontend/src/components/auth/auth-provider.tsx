"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { ShieldCheck } from "lucide-react";
import { configureApiAuth } from "@/lib/api";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

const LOCAL_USER = {
  uid: "local-reviewer",
  displayName: "Local Reviewer",
  email: "local@example.test",
} as unknown as User;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isFirebaseConfigured();
  const [user, setUser] = useState<User | null>(configured ? null : LOCAL_USER);
  const [loading, setLoading] = useState(configured);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) {
      await firebaseSignOut(auth);
    } else {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    if (!configured) {
      setUser(LOCAL_USER);
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    if (!auth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (next) => {
      setUser(next);
      setLoading(false);
    });
  }, [configured]);

  useEffect(() => {
    configureApiAuth(
      async (force) => {
        const auth = getFirebaseAuth();
        return auth?.currentUser?.getIdToken(force) ?? null;
      },
      () => {
        const auth = getFirebaseAuth();
        if (auth) void firebaseSignOut(auth);
      },
    );
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    signIn: async () => {
      const auth = getFirebaseAuth();
      if (auth) {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } else {
        setUser(LOCAL_USER);
      }
    },
    signOut,
  }), [loading, signOut, user]);

  if (loading) return <AuthStatus label="Checking reviewer access" />;
  if (!user) return <SignInScreen onSignIn={value.signIn} />;
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function AuthStatus({ label }: { label: string }) {
  return <main className="grid min-h-screen place-items-center bg-canvas text-ink-500"><p>{label}…</p></main>;
}

function SignInScreen({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [error, setError] = useState("");
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-100 bg-surface p-8 shadow-card text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-bold tracking-tight text-ink-900">ClassAll Operations</h1>
        <p className="mt-1 text-xs text-ink-500">Authorized reviewer authentication required.</p>
        {error && (
          <div className="mt-3 rounded-md bg-rose-50 p-3 text-left text-xs text-rose-700">
            <p className="font-semibold">{error}</p>
            {error.includes("configuration-not-found") && (
              <p className="mt-2 text-ink-600">
                Firebase Authentication is not yet enabled for this project. Visit the{" "}
                <a
                  href="https://console.firebase.google.com/project/gen-lang-client-0866395749/authentication"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-teal-700 underline"
                >
                  Firebase Console
                </a>
                , click <strong>Get started</strong>, and enable the <strong>Google</strong> sign-in provider.
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={async () => {
            setError("");
            try {
              await onSignIn();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Sign-in failed");
            }
          }}
          className="mt-6 w-full rounded-xl bg-teal-700 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-teal-800"
        >
          Sign in with Google
        </button>
      </div>
    </main>
  );
}
