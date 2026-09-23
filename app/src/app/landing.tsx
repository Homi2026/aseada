import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

const colors = {
  ink: '#15201A',
  paper: '#F6F7F1',
  paperDim: '#EEF1E9',
  pine: '#1F5C46',
  pineDark: '#122A20',
  gold: '#E8A93B',
  mist: '#E3EAE1',
  slate: '#5B665F',
};

const FONT_FAMILY = Platform.select({ web: "'Bricolage Grotesque', -apple-system, sans-serif", default: undefined });

const plans = [
  { size: 'Depto pequeño', coverage: 'Hasta 50 m²', duration: '3 horas', price: '$39.990' },
  { size: 'Casa mediana', coverage: 'Hasta 120 m²', duration: '4 horas', price: '$62.990', popular: true },
  { size: 'Casa grande', coverage: 'Hasta 200 m²', duration: '5 horas', price: '$84.990' },
];

// Los valores del ticket tienen que existir en la tabla de precios del
// servidor: 65 m² de aseo sin materiales cae en el tramo de 80 m², que son
// 4 horas incluidas y $43.330 finales para el cliente.
const ticketRows = [
  { label: 'Servicio', value: 'Aseo profundo' },
  { label: 'Dónde', value: 'Providencia, 65 m²' },
  { label: 'Cuándo', value: 'Miércoles, 10:00' },
  { label: 'Aseador', value: 'María T. (4.9 ★)' },
];
const TICKET_TOTAL = '$43.330';

function TactileButton({
  label,
  onPress,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'dark';
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const offset = pressed ? 0 : hovered ? 2 : 4;

  const fill = variant === 'primary' ? colors.pine : variant === 'dark' ? colors.gold : colors.paper;
  const textColor = variant === 'secondary' ? colors.ink : variant === 'dark' ? colors.ink : colors.paper;

  return (
    <View style={[styles.tactileOuter, { paddingRight: offset, paddingBottom: offset }]}>
      <Pressable
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={onPress}
        style={[styles.tactileInner, { backgroundColor: fill }]}
      >
        <Text style={[styles.tactileText, { color: textColor }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

export default function Landing() {
  const { width } = useWindowDimensions();
  const compact = width < 760;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.nav}>
        <Text style={styles.logo}>Aseada</Text>
        <Pressable onPress={() => router.push('/login')}>
          <Text style={styles.navLink}>Ingresar</Text>
        </Pressable>
      </View>

      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={styles.heroCopy}>
          <Text style={[styles.title, compact && styles.titleCompact]}>Tu casa limpia. Tu tiempo, de vuelta.</Text>
          <Text style={styles.description}>
            Conectamos tu hogar con aseadores de confianza y precios claros, para que agendar un aseo sea tan simple
            como debería ser.
          </Text>
          <View style={styles.actions}>
            <TactileButton label="Solicitar un aseo" onPress={() => router.push('/registro')} variant="primary" />
            <TactileButton label="Quiero ser aseador" onPress={() => router.push('/registro')} variant="secondary" />
          </View>
          <Text style={styles.note}>
            Por ahora, solo en Chile. Tu pago queda retenido por Aseada: el aseador lo recibe cuando confirmas que
            el servicio quedó bien.
          </Text>
        </View>

        <View style={[styles.ticketZone, compact && styles.ticketZoneCompact]}>
          <View style={styles.ticketGlow} />
          <View style={styles.ticket}>
            <View style={styles.ticketPerforation}>
              {Array.from({ length: 10 }).map((_, i) => (
                <View key={i} style={styles.ticketHole} />
              ))}
            </View>
            <View style={styles.ticketHeader}>
              <Text style={styles.ticketTitle}>Aseo confirmado</Text>
              <View style={styles.ticketBadge}>
                <Text style={styles.ticketBadgeMark}>✓</Text>
              </View>
            </View>
            {ticketRows.map((row) => (
              <View key={row.label} style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>{row.label}</Text>
                <Text style={styles.ticketValue}>{row.value}</Text>
              </View>
            ))}
            <View style={styles.ticketDivider} />
            <View style={styles.ticketRow}>
              <Text style={styles.ticketTotalLabel}>Total</Text>
              <Text style={styles.ticketTotalValue}>{TICKET_TOTAL}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Precios claros, sin sorpresas</Text>
        <Text style={styles.sectionSubtitle}>Sabes cuánto vas a pagar antes de agendar. Sin letra chica.</Text>
      </View>

      <View style={styles.tableWrap}>
        {!compact && (
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colPlan]}>Plan</Text>
            <Text style={[styles.tableHeaderCell, styles.colCoverage]}>Cobertura</Text>
            <Text style={[styles.tableHeaderCell, styles.colDuration]}>Duración</Text>
            <Text style={[styles.tableHeaderCell, styles.colPrice]}>Precio desde</Text>
          </View>
        )}
        {plans.map((plan) => (
          <View
            key={plan.size}
            style={[styles.tableRow, plan.popular && styles.tableRowPopular, compact && styles.tableRowCompact]}
          >
            {plan.popular && <View style={styles.popularBar} />}
            {compact ? (
              <>
                <View style={styles.compactRowTop}>
                  <View style={styles.compactPlanName}>
                    <Text style={styles.planName}>{plan.size}</Text>
                    {plan.popular && (
                      <View style={styles.popularTag}>
                        <Text style={styles.popularTagText}>La más pedida</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.planPrice}>{plan.price}</Text>
                </View>
                <Text style={styles.compactDetail}>
                  {plan.coverage}, {plan.duration}
                </Text>
              </>
            ) : (
              <>
                <View style={[styles.colPlan, styles.planNameCell]}>
                  <Text style={styles.planName}>{plan.size}</Text>
                  {plan.popular && (
                    <View style={styles.popularTag}>
                      <Text style={styles.popularTagText}>La más pedida</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.colCoverage, styles.cellText]}>{plan.coverage}</Text>
                <Text style={[styles.colDuration, styles.cellText]}>{plan.duration}</Text>
                <Text style={[styles.colPrice, styles.planPrice]}>{plan.price}</Text>
              </>
            )}
          </View>
        ))}
      </View>
      <Text style={styles.tableFootnote}>
        Precio sin materiales de limpieza. Puedes coordinar los insumos directo con tu aseador.
      </Text>

      <View style={[styles.fumigationBand, compact && styles.fumigationBandCompact]}>
        <View style={styles.fumigationCopy}>
          <Text style={styles.fumigationTitle}>También cuidamos lo que no se ve</Text>
          <Text style={styles.fumigationText}>
            Fumigación residencial para insectos, roedores o ambos. Cuéntanos qué pasa en tu hogar y te damos un
            precio referencial antes de solicitar.
          </Text>
        </View>
        <View style={styles.fumigationStats}>
          <View style={styles.fumigationStat}>
            <Text style={styles.fumigationStatLabel}>Insectos</Text>
            <Text style={styles.fumigationStatValue}>desde $59.990</Text>
          </View>
          <View style={styles.fumigationStat}>
            <Text style={styles.fumigationStatLabel}>Roedores</Text>
            <Text style={styles.fumigationStatValue}>desde $72.990</Text>
          </View>
        </View>
      </View>

      <View style={[styles.bottomBand, compact && styles.bottomBandCompact]}>
        <View style={styles.bottomCopy}>
          <Text style={styles.bottomTitle}>¿Eres detallista y responsable?</Text>
          <Text style={styles.bottomText}>Únete a Aseada y encuentra nuevos clientes.</Text>
        </View>
        <TactileButton label="Trabajar con Aseada" onPress={() => router.push('/registro')} variant="dark" />
      </View>

      <View style={[styles.footer, compact && styles.footerCompact]}>
        <Text style={styles.footerBrand}>Aseada</Text>
        {/* Sin enlace a redes hasta que exista la cuenta: el link apuntaba al
            home de Instagram, no a un perfil de Aseada. */}
        <Text style={styles.footerText}>© 2026 Aseada</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper, fontFamily: FONT_FAMILY },
  content: { paddingBottom: 32 },

  nav: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 28,
    paddingBottom: 20,
  },
  logo: { color: colors.pine, fontSize: 24, fontWeight: '800' },
  navLink: { color: colors.ink, fontSize: 15, fontWeight: '600' },

  hero: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: 50,
    paddingBottom: 90,
    gap: 48,
  },
  heroCompact: { flexDirection: 'column', alignItems: 'stretch', paddingTop: 30, paddingBottom: 56, gap: 48 },
  heroCopy: { flex: 1, maxWidth: 600 },
  title: { color: colors.ink, fontSize: 56, lineHeight: 60, fontWeight: '700', letterSpacing: -1, marginBottom: 22 },
  titleCompact: { fontSize: 40, lineHeight: 44, letterSpacing: -0.5 },
  description: { color: colors.slate, fontSize: 18, lineHeight: 27, maxWidth: 480, marginBottom: 30 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 20, alignItems: 'flex-start' },
  note: { color: colors.slate, fontSize: 13 },

  tactileOuter: { backgroundColor: colors.ink, borderRadius: 12, alignSelf: 'flex-start' },
  tactileInner: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.ink,
    paddingHorizontal: 22,
    paddingVertical: 15,
    ...(Platform.OS === 'web' ? ({ transitionProperty: 'transform', transitionDuration: '100ms' } as object) : {}),
  },
  tactileText: { fontSize: 15, fontWeight: '700' },

  ticketZone: { width: 340, alignItems: 'center', justifyContent: 'center' },
  ticketZoneCompact: { width: '100%' },
  ticketGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.mist,
    top: 10,
  },
  ticket: {
    width: 300,
    backgroundColor: colors.paper,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.ink,
    padding: 20,
    paddingTop: 14,
    transform: [{ rotate: '-2.5deg' }],
  },
  ticketPerforation: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  ticketHole: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.mist },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  ticketTitle: { color: colors.pine, fontSize: 17, fontWeight: '700' },
  ticketBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketBadgeMark: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  ticketRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  ticketLabel: { color: colors.slate, fontSize: 13 },
  ticketValue: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  ticketDivider: { height: 1, backgroundColor: colors.mist, marginVertical: 8 },
  ticketTotalLabel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  ticketTotalValue: { color: colors.ink, fontSize: 20, fontWeight: '800' },

  sectionHeader: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 28, marginBottom: 26 },
  sectionTitle: { color: colors.ink, fontSize: 32, fontWeight: '700', marginBottom: 8 },
  sectionSubtitle: { color: colors.slate, fontSize: 16 },

  tableWrap: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 28 },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: colors.ink,
    paddingBottom: 10,
    marginBottom: 4,
  },
  tableHeaderCell: { color: colors.slate, fontSize: 13, fontWeight: '600' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.mist,
    position: 'relative',
  },
  tableRowCompact: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  tableRowPopular: { backgroundColor: colors.paperDim, paddingLeft: 16 },
  popularBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.gold },

  compactRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compactPlanName: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactDetail: { color: colors.slate, fontSize: 14 },

  colPlan: { flex: 1.3 },
  colCoverage: { flex: 1 },
  colDuration: { flex: 1 },
  colPrice: { flex: 1, textAlign: 'right' },
  planNameCell: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cellText: { color: colors.slate, fontSize: 15 },
  planName: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  planPrice: { color: colors.ink, fontSize: 22, fontWeight: '800', textAlign: 'right' },
  popularTag: { backgroundColor: colors.gold, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  popularTagText: { color: colors.ink, fontSize: 12, fontWeight: '700' },

  tableFootnote: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    paddingHorizontal: 28,
    color: colors.slate,
    fontSize: 13,
    marginTop: 14,
    marginBottom: 74,
  },

  fumigationBand: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    marginBottom: 74,
    marginHorizontal: 28,
    paddingHorizontal: 30,
    paddingVertical: 34,
    backgroundColor: colors.pine,
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 28,
  },
  fumigationBandCompact: { flexDirection: 'column', alignItems: 'stretch', width: 'auto' },
  fumigationCopy: { flex: 1, maxWidth: 620 },
  fumigationTitle: { color: colors.paper, fontSize: 26, fontWeight: '700', marginBottom: 10 },
  fumigationText: { color: colors.mist, fontSize: 15, lineHeight: 23 },
  fumigationStats: { flexDirection: 'row', gap: 28 },
  fumigationStat: {},
  fumigationStatLabel: { color: colors.mist, fontSize: 13, marginBottom: 4 },
  fumigationStatValue: { color: colors.gold, fontSize: 19, fontWeight: '800' },

  bottomBand: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    marginHorizontal: 28,
    padding: 28,
    borderRadius: 20,
    backgroundColor: colors.pineDark,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 20,
  },
  bottomBandCompact: { width: 'auto', flexDirection: 'column', alignItems: 'stretch' },
  bottomCopy: {},
  bottomTitle: { color: colors.paper, fontSize: 22, fontWeight: '700', marginBottom: 5 },
  bottomText: { color: colors.mist, fontSize: 15 },

  footer: {
    width: '100%',
    maxWidth: 1180,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingHorizontal: 28,
    paddingTop: 36,
  },
  footerCompact: { paddingHorizontal: 28, flexWrap: 'wrap' },
  footerBrand: { color: colors.pine, fontSize: 16, fontWeight: '800' },
  footerText: { color: colors.slate, fontSize: 13, marginLeft: 'auto' },
});
