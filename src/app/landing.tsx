import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

const plans = [
  { size: 'Depto pequeño', detail: 'Hasta 50 m² · 3 horas', price: '$30.950', tone: '#dcefe5' },
  { size: 'Casa mediana', detail: 'Hasta 120 m² · 4 horas', price: '$55.710', tone: '#f5e6bd' },
  { size: 'Casa grande', detail: 'Hasta 200 m² · 5 horas', price: '$74.280', tone: '#f3d7cf' },
];

export default function Landing() {
  const { width } = useWindowDimensions();
  const compact = width < 760;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.nav}>
        <Text style={styles.logo}>Aseada</Text>
        <TouchableOpacity onPress={() => router.push('/login')}><Text style={styles.navLink}>Ingresar</Text></TouchableOpacity>
      </View>

      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>Limpieza simple, hogares tranquilos</Text>
          <Text style={[styles.title, compact && styles.titleCompact]}>Tu casa limpia. Tu tiempo, de vuelta.</Text>
          <Text style={styles.description}>Conectamos tu hogar con aseadores confiables, precios claros y un servicio pensado para que todo sea más fácil.</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.push('/registro')}><Text style={styles.primaryText}>Solicitar un aseo</Text></TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/registro')}><Text style={styles.secondaryText}>Quiero ser aseador</Text></TouchableOpacity>
          </View>
          <Text style={styles.note}>Disponible primero en Chile · Pago seguro en preparación</Text>
        </View>
        <View style={[styles.heroVisual, compact && styles.heroVisualCompact]}>
          <View style={styles.sun} />
          <Text style={styles.visualEmoji}>🧹</Text>
          <Text style={styles.visualLabel}>Más limpio, más liviano</Text>
        </View>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>Precios orientativos</Text>
        <Text style={styles.sectionTitle}>Parte sabiendo cuánto cuesta</Text>
      </View>
      <View style={styles.planGrid}>
        {plans.map((plan) => (
          <View key={plan.size} style={[styles.plan, { backgroundColor: plan.tone }]}>
            <Text style={styles.planSize}>{plan.size}</Text>
            <Text style={styles.planDetail}>{plan.detail}</Text>
            <Text style={styles.planPrice}>{plan.price}</Text>
            <Text style={styles.planFoot}>desde · sin materiales</Text>
          </View>
        ))}
      </View>

      <View style={[styles.serviceIntro, compact && styles.serviceIntroCompact]}>
        <View style={styles.serviceCopy}>
          <Text style={styles.sectionEyebrow}>Nueva categoría</Text>
          <Text style={styles.serviceTitle}>También cuidamos lo que no se ve.</Text>
          <Text style={styles.serviceText}>Fumigación residencial para insectos, roedores o problemas mixtos. Elige tu hogar y recibe un precio referencial antes de solicitar.</Text>
        </View>
        <View style={styles.servicePrices}>
          <View><Text style={styles.serviceLabel}>Insectos</Text><Text style={styles.servicePrice}>desde $49.396</Text></View>
          <View><Text style={styles.serviceLabel}>Roedores</Text><Text style={styles.servicePrice}>desde $61.776</Text></View>
        </View>
      </View>

      <View style={[styles.bottomBand, compact && styles.bottomBandCompact]}>
        <View>
          <Text style={styles.bottomTitle}>¿Eres detallista y responsable?</Text>
          <Text style={styles.bottomText}>Únete a Aseada y encuentra nuevos clientes.</Text>
        </View>
        <TouchableOpacity style={styles.darkButton} onPress={() => router.push('/registro')}><Text style={styles.darkButtonText}>Trabajar con Aseada</Text></TouchableOpacity>
      </View>

      <View style={[styles.footer, compact && styles.footerCompact]}>
        <Text style={styles.footerBrand}>Aseada</Text>
        <TouchableOpacity onPress={() => Linking.openURL('https://www.instagram.com/')}><Text style={styles.footerLink}>Instagram</Text></TouchableOpacity>
        <Text style={styles.footerText}>© 2026 Aseada</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8faf6' },
  content: { paddingBottom: 32 },
  nav: { width: '100%', maxWidth: 1180, alignSelf: 'center', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 28, paddingTop: 28, paddingBottom: 20 },
  logo: { color: '#1f6b4f', fontSize: 28, fontWeight: '900', letterSpacing: 0 },
  navLink: { color: '#1f6b4f', fontSize: 15, fontWeight: '800' },
  hero: { width: '100%', maxWidth: 1180, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, paddingTop: 54, paddingBottom: 86, gap: 36 },
  heroCompact: { flexDirection: 'column', alignItems: 'stretch', paddingTop: 30, paddingBottom: 52, gap: 34 },
  heroCopy: { flex: 1, maxWidth: 650 },
  eyebrow: { color: '#d06b4d', fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 18 },
  title: { color: '#17231b', fontSize: 56, lineHeight: 61, fontWeight: '900', marginBottom: 20 },
  titleCompact: { fontSize: 42, lineHeight: 47 },
  description: { color: '#5e6a61', fontSize: 18, lineHeight: 28, maxWidth: 560, marginBottom: 30 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  primaryButton: { backgroundColor: '#1f6b4f', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 16 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondaryButton: { borderWidth: 1, borderColor: '#b7c9bc', borderRadius: 12, paddingHorizontal: 22, paddingVertical: 16 },
  secondaryText: { color: '#1f6b4f', fontSize: 15, fontWeight: '800' },
  note: { color: '#89948c', fontSize: 13 },
  heroVisual: { width: 330, height: 330, borderRadius: 165, backgroundColor: '#dcefe5', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroVisualCompact: { width: 240, height: 240, borderRadius: 120, alignSelf: 'center' },
  sun: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: '#f5d98d', top: 22, right: -22 },
  visualEmoji: { fontSize: 104, transform: [{ rotate: '-12deg' }] },
  visualLabel: { color: '#1f6b4f', fontSize: 15, fontWeight: '800', marginTop: 16 },
  sectionHeader: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 28, marginBottom: 22 },
  sectionEyebrow: { color: '#d06b4d', fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 8 },
  sectionTitle: { color: '#17231b', fontSize: 31, fontWeight: '900' },
  planGrid: { width: '100%', maxWidth: 1180, alignSelf: 'center', flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 28, gap: 14, marginBottom: 74 },
  plan: { flex: 1, minWidth: 210, borderRadius: 20, padding: 22, minHeight: 154 },
  planSize: { color: '#17231b', fontSize: 17, fontWeight: '800', marginBottom: 5 },
  planDetail: { color: '#657066', fontSize: 14, marginBottom: 22 },
  planPrice: { color: '#17231b', fontSize: 30, fontWeight: '900' },
  planFoot: { color: '#657066', fontSize: 12, marginTop: 2 },
  serviceIntro: { width: '100%', maxWidth: 1180, alignSelf: 'center', marginBottom: 74, paddingHorizontal: 28, paddingVertical: 30, backgroundColor: '#f3d7cf', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 24 },
  serviceIntroCompact: { flexDirection: 'column', alignItems: 'stretch', marginBottom: 52 },
  serviceCopy: { flex: 1, maxWidth: 660 },
  serviceTitle: { color: '#17231b', fontSize: 28, fontWeight: '900', marginBottom: 8 },
  serviceText: { color: '#5e6a61', fontSize: 15, lineHeight: 23 },
  servicePrices: { gap: 14, minWidth: 190 },
  serviceLabel: { color: '#7e493b', fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  servicePrice: { color: '#17231b', fontSize: 18, fontWeight: '900' },
  bottomBand: { width: '100%', maxWidth: 1180, alignSelf: 'center', marginHorizontal: 28, padding: 26, borderRadius: 18, backgroundColor: '#1f6b4f', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 18 },
  bottomBandCompact: { width: 'auto', marginHorizontal: 20, flexDirection: 'column', alignItems: 'stretch' },
  bottomTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginBottom: 5 },
  bottomText: { color: '#dcefe5', fontSize: 15 },
  darkButton: { backgroundColor: '#f5d98d', borderRadius: 11, paddingHorizontal: 18, paddingVertical: 14 },
  darkButtonText: { color: '#17231b', fontSize: 14, fontWeight: '800' },
  footer: { width: '100%', maxWidth: 1180, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 24, paddingHorizontal: 28, paddingTop: 36 },
  footerCompact: { paddingHorizontal: 28, flexWrap: 'wrap' },
  footerBrand: { color: '#1f6b4f', fontSize: 18, fontWeight: '900' },
  footerLink: { color: '#5e6a61', fontSize: 14 },
  footerText: { color: '#9aa39c', fontSize: 13, marginLeft: 'auto' },
});
