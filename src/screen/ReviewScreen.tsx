import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Alert, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import { TellMe } from '../components/TellMe';
import { typography } from '../constants/typography';
import { PrimaryButton } from '../components/PrimaryButton';
import { useFitness } from '../context/FitnessContext';
import type { SessionVerdict, SessionGripe } from '../events/session';
import type { RootStackScreenProps } from '../navigation/types';

/**
 * The one question the app cannot answer for itself.
 *
 * Everything else it knows it derived: which exercises, how many sets, how hard
 * each set felt. None of that says whether the SESSION was the right session.
 * The engine prescribes volume and load from rules and has never once been told
 * whether the result was any good — so this is the calibration signal, and the
 * only one six testers can give that no amount of engineering can replace.
 *
 * Asked HERE, not later, because "how was Tuesday?" gets a shrug by Wednesday.
 *
 * Deliberately one required tap. A review that takes effort in a gym with
 * sweaty hands is a review that gets abandoned, and abandoning it leaves the
 * session unfinished — so the required part is three big buttons and the rest
 * is optional.
 */

const VERDICTS: { value: SessionVerdict; label: string; sub: string }[] = [
  { value: 'too_easy',    label: 'Too easy',    sub: 'I had more in me' },
  { value: 'about_right', label: 'About right', sub: 'Hard but doable' },
  { value: 'too_much',    label: 'Too much',    sub: 'I was cooked' },
];

const GRIPES: { value: SessionGripe; label: string }[] = [
  { value: 'wrong_exercises',   label: 'Wrong exercises for me' },
  { value: 'too_long',          label: 'Took too long' },
  { value: 'too_short',         label: 'Too short' },
  { value: 'something_hurt',    label: 'Something hurt' },
  { value: 'equipment_missing', label: "Didn't have the kit" },
  { value: 'confusing',         label: 'Confusing' },
];

export default function ReviewScreen({
  navigation, route,
}: RootStackScreenProps<'Review'>): React.ReactElement {
  const { finishSession } = useFitness();
  const { sessionId } = route.params;

  const [verdict, setVerdict] = useState<SessionVerdict | null>(null);
  const [gripes, setGripes] = useState<SessionGripe[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // The session is not finished until this is answered, so leaving by the
  // hardware back button would strand an active session with no route back to
  // this screen. Block it and say why, rather than silently swallowing it.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'One tap left',
        "Your session isn't saved until you tell me how it went. It takes one tap.",
      );
      return true;
    });
    return () => sub.remove();
  }, []);

  const toggleGripe = (g: SessionGripe) =>
    setGripes((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const submit = () => {
    if (verdict === null || busy) return;
    setBusy(true);
    void finishSession(sessionId, {
      verdict,
      gripes,
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    })
      .then(() => navigation.replace('Completion'))
      .catch((e: unknown) => {
        setBusy(false);
        Alert.alert(
          "Couldn't save that",
          e instanceof Error ? e.message : String(e),
        );
      });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>LAST THING</Text>
          <Text style={[typography.largeTitle, styles.title]}>How was that?</Text>
          <Text style={styles.intro}>
            I picked that session from rules. You're the only one who knows if it
            was right — and it's the thing I most need to hear.
          </Text>

          {VERDICTS.map((v) => {
            const on = verdict === v.value;
            return (
              <TouchableOpacity
                key={v.value}
                style={[styles.verdict, on && styles.verdictOn]}
                onPress={() => setVerdict(v.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.verdictLabel, on && styles.onText]}>{v.label}</Text>
                <Text style={[styles.verdictSub, on && styles.onSubText]}>{v.sub}</Text>
              </TouchableOpacity>
            );
          })}

          <Text style={styles.section}>ANYTHING WRONG? (OPTIONAL)</Text>
          <View style={styles.chips}>
            {GRIPES.map((g) => {
              const on = gripes.includes(g.value);
              return (
                <TouchableOpacity
                  key={g.value}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => toggleGripe(g.value)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.chipText, on && styles.onText]}>{g.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.section}>IN YOUR OWN WORDS (OPTIONAL)</Text>
          <TextInput
            style={styles.note}
            value={note}
            onChangeText={setNote}
            placeholder="Anything at all — what worked, what didn't, what you'd change."
            placeholderTextColor={colors.textTertiary}
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />

          <PrimaryButton
            title={busy ? 'Saving…' : 'Save my session'}
            onPress={submit}
            disabled={verdict === null || busy}
            style={styles.cta}
          />
          {verdict === null && (
            <Text style={styles.footnote}>Pick one of the three above to finish.</Text>
          )}
          <TellMe where="Review" label="Something else you want to tell me?" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 20, paddingBottom: 56, paddingTop: 16 },
  eyebrow: {
    fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
    color: colors.primary, marginLeft: 2,
  },
  title: { marginTop: 8, marginBottom: 10 },
  intro: { fontSize: 15, lineHeight: 22, color: colors.textMuted, marginBottom: 22 },
  verdict: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1,
    borderColor: colors.separator, paddingVertical: 16, paddingHorizontal: 18,
    marginBottom: 10, minHeight: 72, justifyContent: 'center',
  },
  verdictOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  verdictLabel: { fontSize: 18, fontWeight: '600', color: colors.text },
  verdictSub: { fontSize: 14, color: colors.textMuted, marginTop: 3 },
  onText: { color: '#FFFFFF' },
  onSubText: { color: 'rgba(255,255,255,0.82)' },
  section: {
    ...typography.sectionHeader, marginTop: 28, marginBottom: 10, marginLeft: 2,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 48, paddingHorizontal: 15, justifyContent: 'center',
    borderRadius: 24, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.separator,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, color: colors.text },
  note: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1,
    borderColor: colors.separator, padding: 14, minHeight: 110,
    fontSize: 16, lineHeight: 22, color: colors.text,
  },
  cta: { marginTop: 30 },
  footnote: {
    fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 10,
  },
});
