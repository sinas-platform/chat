import styles from"./Login.module.scss";

export function LoginPage() {
  return (
    <div className={styles.loginPage}>
      <div className={styles.loginCard}>
        <h1>Login</h1>
        <p>OTP + workspace selection comes next.</p>
      </div>
    </div>
  );
}
