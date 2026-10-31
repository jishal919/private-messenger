import AuthForm from "@/components/AuthForm";

export default function RegisterPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Create an account</h1>
        <p className="subtitle">Just a username and password — nothing else.</p>
        <AuthForm mode="register" />
      </div>
    </div>
  );
}
