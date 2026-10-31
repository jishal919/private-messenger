import AuthForm from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Welcome back</h1>
        <p className="subtitle">Log in to keep the conversation going.</p>
        <AuthForm mode="login" />
      </div>
    </div>
  );
}
