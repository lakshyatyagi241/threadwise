import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { useAuth } from '../src/auth';
import { useTheme } from '../src/theme';

type Authed = { status: 'authenticated'; orgSlug: string; tokens: { accessToken: string; refreshToken: string } };
type Mfa = { status: 'mfa_required'; challengeToken: string };
type Pick = { status: 'workspace_required'; selectionToken: string; workspaces: { slug: string; name: string }[] };

export default function Login() {
  const t = useTheme();
  const { signedIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Mfa | Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handle = async (r: Authed | Mfa | Pick) => {
    if (r.status === 'authenticated')
      await signedIn({ accessToken: r.tokens.accessToken, refreshToken: r.tokens.refreshToken, orgSlug: r.orgSlug });
    else setStep(r);
  };
  const run = async (fn: () => Promise<Authed | Mfa | Pick>) => {
    setBusy(true);
    setErr('');
    try {
      await handle(await fn());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const input = {
    backgroundColor: t.card, color: t.text, borderColor: t.line, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, marginBottom: 12,
  } as const;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg, justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 30, fontWeight: '800', color: t.primary, marginBottom: 4 }}>Reference</Text>
      <Text style={{ color: t.sub, marginBottom: 28 }}>Sign in to your team inbox</Text>

      {step?.status === 'workspace_required' ? (
        <>
          <Text style={{ color: t.text, fontWeight: '600', marginBottom: 10 }}>Choose a workspace</Text>
          {step.workspaces.map((w) => (
            <Pressable
              key={w.slug}
              onPress={() => run(() => api('/auth/login/workspace', { method: 'POST', body: { selectionToken: (step as Pick).selectionToken, orgSlug: w.slug } }))}
              style={{ ...input, marginBottom: 8 }}
            >
              <Text style={{ color: t.text, fontSize: 16 }}>{w.name}</Text>
            </Pressable>
          ))}
        </>
      ) : step?.status === 'mfa_required' ? (
        <>
          <TextInput style={input} placeholder="6-digit code" placeholderTextColor={t.sub} keyboardType="number-pad" value={code} onChangeText={setCode} maxLength={6} />
          <Button t={t} busy={busy} label="Verify" onPress={() => run(() => api('/auth/login/mfa', { method: 'POST', body: { challengeToken: (step as Mfa).challengeToken, code } }))} />
        </>
      ) : (
        <>
          <TextInput style={input} placeholder="Email" placeholderTextColor={t.sub} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
          <TextInput style={input} placeholder="Password" placeholderTextColor={t.sub} secureTextEntry value={password} onChangeText={setPassword} />
          <Button t={t} busy={busy} label="Sign in" onPress={() => run(() => api('/auth/login', { method: 'POST', body: { email: email.trim(), password, remember: true } }))} />
        </>
      )}
      {!!err && <Text style={{ color: t.danger, marginTop: 14 }}>{err}</Text>}
    </KeyboardAvoidingView>
  );
}

function Button({ t, busy, label, onPress }: { t: ReturnType<typeof useTheme>; busy: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={{ backgroundColor: t.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
      {busy ? <ActivityIndicator color={t.onPrimary} /> : <Text style={{ color: t.onPrimary, fontWeight: '700', fontSize: 16 }}>{label}</Text>}
    </Pressable>
  );
}
