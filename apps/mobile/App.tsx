import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api } from './src/api';
import { stateLabel, timeAgo } from './src/format';
import { haptics } from './src/haptics';
import { colors, mapStyle } from './src/theme';
import type { FleetAlert, SessionUser, Vehicle, VehicleState } from './src/types';
import { FleetLoadingSkeleton, GlassSurface, SpringPressable } from './src/ui';
import { useFleet } from './src/useFleet';
import { useRouteReplay } from './src/use-route-replay';
import { VehicleContextPreview } from './src/vehicle-context-preview';

type Tab = 'pulse' | 'fleet' | 'replay' | 'alerts' | 'profile';

const DEFAULT_REGION: Region = { latitude: 33.3152, longitude: 44.3661, latitudeDelta: 0.32, longitudeDelta: 0.32 };

function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api.session().then(setUser).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);

  return <SafeAreaProvider>{checking ? <Splash /> : user ? <Pulse user={user} onLogout={() => setUser(null)} /> : <Login onLogin={setUser} />}</SafeAreaProvider>;
}

function Splash() {
  return (
    <View style={styles.splash}>
      <StatusBar style="light" />
      <View style={styles.brandMark}><Text style={styles.brandArrow}>↗</Text></View>
      <Text style={styles.splashName}>CARVA <Text style={styles.splashAccent}>PULSE</Text></Text>
      <ActivityIndicator color={colors.lime} style={{ marginTop: 28 }} />
    </View>
  );
}

function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError('Enter your Carva GPS email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(email.trim(), password);
      await haptics.success();
      onLogin(user);
    } catch {
      await haptics.error();
      setError('We could not sign you in. Check your email and password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.loginSafe} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <LinearGradient colors={['#102B50', colors.ink]} style={StyleSheet.absoluteFill} />
      <View style={styles.loginGlowA} /><View style={styles.loginGlowB} />
      <ScrollView contentContainerStyle={styles.loginContent} keyboardShouldPersistTaps="handled">
        <View style={styles.loginBrand}><View style={styles.brandMark}><Text style={styles.brandArrow}>↗</Text></View><Text style={styles.loginBrandText}>CARVA <Text style={styles.splashAccent}>PULSE</Text></Text></View>
        <View style={styles.loginHero}>
          <Text style={styles.kicker}>YOUR FLEET, IN FLOW</Text>
          <Text style={styles.loginTitle}>Everything moving.{"\n"}<Text style={{ color: colors.lime }}>Nothing missed.</Text></Text>
          <Text style={styles.loginCopy}>A real-time GPS command center, designed for the way your day actually moves.</Text>
        </View>
        <View style={styles.loginCard}>
          <Text style={styles.cardEyebrow}>SIGN IN TO CARVA</Text>
          <Text style={styles.inputLabel}>Email address</Text>
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@company.com" placeholderTextColor={colors.dim} style={styles.input} value={email} onChangeText={setEmail} />
          <Text style={styles.inputLabel}>Password</Text>
          <TextInput autoCapitalize="none" autoComplete="password" secureTextEntry placeholder="Your password" placeholderTextColor={colors.dim} style={styles.input} value={password} onChangeText={setPassword} onSubmitEditing={submit} />
          {error ? <Text style={styles.formError}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={submit} style={({ pressed }) => [styles.loginButton, pressed && styles.pressed, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.ink} /> : <><Text style={styles.loginButtonText}>Enter command center</Text><MaterialCommunityIcons name="arrow-top-right" size={20} color={colors.ink} /></>}
          </Pressable>
        </View>
        <Text style={styles.loginFine}>Your tracker data stays protected through your Carva GPS account.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Pulse({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('pulse');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewVehicle, setPreviewVehicle] = useState<Vehicle | null>(null);
  const [favouriteIds, setFavouriteIds] = useState<Set<number>>(new Set());
  const fleet = useFleet(true);
  const selected = useMemo(() => fleet.vehicles.find((vehicle) => vehicle.device.id === selectedId) || fleet.vehicles[0], [fleet.vehicles, selectedId]);

  useEffect(() => {
    if (selected && selected.device.id !== selectedId) setSelectedId(selected.device.id);
  }, [selected, selectedId]);

  const openVehicle = (vehicle: Vehicle) => {
    setSelectedId(vehicle.device.id);
    setTab('pulse');
  };
  const openReplay = (vehicle: Vehicle) => {
    setSelectedId(vehicle.device.id);
    setTab('replay');
  };
  const toggleFavourite = (vehicle: Vehicle) => {
    setFavouriteIds((current) => {
      const next = new Set(current);
      next.has(vehicle.device.id) ? next.delete(vehicle.device.id) : next.add(vehicle.device.id);
      return next;
    });
  };
  const logout = async () => { await api.logout(); onLogout(); };

  return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        {tab === 'pulse' ? <CommandCenter selected={selected} vehicles={fleet.vehicles} alerts={fleet.alerts} error={fleet.error} updatedAt={fleet.updatedAt} canControl={!user.readonly} onAlerts={() => setTab('alerts')} onReplay={openReplay} onSelect={openVehicle} /> : null}
        {tab === 'fleet' ? <FleetScreen {...fleet} selected={selected} favouriteIds={favouriteIds} onPreview={setPreviewVehicle} onSelect={openVehicle} /> : null}
        {tab === 'replay' ? <ReplayScreen vehicles={fleet.vehicles} selected={selected} onSelect={openReplay} /> : null}
        {tab === 'alerts' ? <AlertsScreen alerts={fleet.alerts} onSelect={openVehicle} /> : null}
        {tab === 'profile' ? <ProfileScreen user={user} fleet={fleet.vehicles} onLogout={logout} /> : null}
        <BottomNav active={tab} alertCount={fleet.alerts.length} onChange={setTab} />
        <VehicleContextPreview vehicle={previewVehicle} favourite={previewVehicle ? favouriteIds.has(previewVehicle.device.id) : false} onClose={() => setPreviewVehicle(null)} onOpen={openVehicle} onToggleFavourite={toggleFavourite} />
      </SafeAreaView>
  );
}

function CommandCenter({ selected, vehicles, alerts, error, updatedAt, canControl, onAlerts, onReplay, onSelect }: { selected?: Vehicle; vehicles: Vehicle[]; alerts: FleetAlert[]; error: string | null; updatedAt: number | null; canControl: boolean; onAlerts: () => void; onReplay: (vehicle: Vehicle) => void; onSelect: (vehicle: Vehicle) => void }) {
  const mapRef = useRef<MapView>(null);
  const position = selected?.position;
  const region = position ? { latitude: position.latitude, longitude: position.longitude, latitudeDelta: 0.035, longitudeDelta: 0.035 } : DEFAULT_REGION;

  useEffect(() => { if (position) mapRef.current?.animateToRegion(region, 650); }, [position?.id]);
  const centreOnMe = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return;
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    mapRef.current?.animateToRegion({ latitude: current.coords.latitude, longitude: current.coords.longitude, latitudeDelta: 0.035, longitudeDelta: 0.035 }, 550);
  };
  const centreOnVehicle = () => { if (position) mapRef.current?.animateToRegion(region, 500); };

  return (
    <View style={styles.command}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={region} customMapStyle={mapStyle as never} showsCompass={false} toolbarEnabled={false} rotateEnabled={false}>
        {vehicles.filter((vehicle) => vehicle.position).map((vehicle) => <VehicleMarker key={vehicle.device.id} vehicle={vehicle} active={vehicle.device.id === selected?.device.id} onPress={() => onSelect(vehicle)} />)}
      </MapView>
      <LinearGradient colors={[colors.ink, 'rgba(7,16,31,0.55)', 'transparent']} locations={[0, .55, 1]} style={styles.topFade} pointerEvents="none" />
      <View style={styles.commandTop}>
        <View><Text style={styles.commandOverline}>CARVA PULSE</Text><View style={styles.liveRow}><View style={styles.liveDot} /><Text style={styles.liveText}>{error ? 'RECONNECTING' : 'LIVE NOW'}</Text><Text style={styles.liveSub}>{updatedAt ? ' · synced just now' : ''}</Text></View></View>
        <Pressable style={styles.roundButton} onPress={onAlerts}><MaterialCommunityIcons name="bell-outline" size={22} color={colors.text} />{alerts.length ? <View style={styles.notificationDot}><Text style={styles.notificationText}>{Math.min(alerts.length, 9)}</Text></View> : null}</Pressable>
      </View>
      <View style={styles.mapTools}>
        <Pressable style={styles.tool} onPress={centreOnMe}><MaterialCommunityIcons name="crosshairs-gps" size={21} color={colors.cyan} /></Pressable>
        <Pressable style={styles.tool} onPress={centreOnVehicle}><MaterialCommunityIcons name="car-arrow-right" size={21} color={colors.lime} /></Pressable>
      </View>
      {error ? <View style={styles.connectionBanner}><MaterialCommunityIcons name="wifi-strength-alert-outline" size={17} color={colors.amber} /><Text style={styles.connectionText}>Live data paused — checking connection</Text></View> : null}
      <View style={styles.mapSheet}>
        <View style={styles.sheetHandle} />
        {selected ? <VehicleSheet vehicle={selected} canControl={canControl} vehicleCount={vehicles.length} onReplay={() => onReplay(selected)} onCycle={() => { const index = vehicles.findIndex((v) => v.device.id === selected.device.id); onSelect(vehicles[(index + 1) % vehicles.length]); }} /> : <EmptyFleet />}
      </View>
    </View>
  );
}

function VehicleMarker({ vehicle, active, onPress }: { vehicle: Vehicle; active: boolean; onPress: () => void }) {
  const tone = toneFor(vehicle.state);
  return <Marker coordinate={{ latitude: vehicle.position!.latitude, longitude: vehicle.position!.longitude }} anchor={{ x: .5, y: .5 }} onPress={onPress} tracksViewChanges={false}>
    <View style={[styles.markerHalo, active && { borderColor: tone, backgroundColor: `${tone}28` }]}><View style={[styles.markerCore, { backgroundColor: tone }]}><MaterialCommunityIcons name={iconFor(vehicle)} size={19} color={colors.ink} style={{ transform: [{ rotate: `${vehicle.position?.course || 0}deg` }] }} /></View></View>
  </Marker>;
}

function VehicleSheet({ vehicle, canControl, vehicleCount, onReplay, onCycle }: { vehicle: Vehicle; canControl: boolean; vehicleCount: number; onReplay: () => void; onCycle: () => void }) {
  const [sending, setSending] = useState(false);
  const tone = toneFor(vehicle.state);
  const command = (type: 'engineResume' | 'engineStop') => {
    const isStop = type === 'engineStop';
    Alert.alert(isStop ? 'Stop vehicle engine?' : 'Restore vehicle engine?', isStop ? `Send an engine-stop command to ${vehicle.device.name}? Only use this once the vehicle is safely parked.` : `Send an engine-resume command to ${vehicle.device.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: isStop ? 'Stop engine' : 'Restore engine', style: isStop ? 'destructive' : 'default', onPress: async () => {
        setSending(true);
        try { await api.sendCommand(vehicle.device.id, type); await haptics.success(); Alert.alert('Command sent', `${vehicle.device.name} will receive the command when its tracker is connected.`); }
        catch { await haptics.error(); Alert.alert('Command not sent', 'The tracker could not accept that command. Try again when it is online.'); }
        finally { setSending(false); }
      } },
    ]);
  };
  return <>
    <View style={styles.sheetHeading}>
      <View style={[styles.vehicleGlyph, { backgroundColor: `${tone}22`, borderColor: `${tone}55` }]}><MaterialCommunityIcons name={iconFor(vehicle)} size={23} color={tone} /></View>
      <Pressable style={styles.vehicleName} onPress={onCycle}><Text style={styles.vehicleTitle} numberOfLines={1}>{vehicle.device.name}</Text><View style={styles.vehicleMeta}><View style={[styles.stateDot, { backgroundColor: tone }]} /><Text style={[styles.stateText, { color: tone }]}>{stateLabel(vehicle.state)}</Text><Text style={styles.muted}>· {timeAgo(vehicle.position?.fixTime || vehicle.device.lastUpdate)}</Text></View></Pressable>
      {vehicleCount > 1 ? <Pressable style={styles.switchVehicle} onPress={onCycle}><MaterialCommunityIcons name="swap-horizontal" size={20} color={colors.text} /></Pressable> : null}
    </View>
    <View style={styles.telemetry}>
      <Telemetry icon="speedometer" label="SPEED" value={`${vehicle.speedKmh}`} unit="km/h" accent={vehicle.speedKmh > 0 ? colors.lime : colors.text} />
      <Telemetry icon="engine-outline" label="IGNITION" value={vehicle.ignition ? 'ON' : 'OFF'} accent={vehicle.ignition ? colors.mint : colors.muted} />
      <Telemetry icon="battery-medium" label="TRACKER" value={vehicle.battery !== undefined ? `${vehicle.battery}%` : '—'} accent={(vehicle.battery || 100) <= 20 ? colors.coral : colors.text} />
    </View>
    <View style={styles.address}><MaterialCommunityIcons name="map-marker-radius-outline" size={18} color={colors.cyan} /><Text style={styles.addressText} numberOfLines={2}>{vehicle.position?.address || (vehicle.position ? `${vehicle.position.latitude.toFixed(5)}, ${vehicle.position.longitude.toFixed(5)}` : 'Waiting for the tracker’s first location')}</Text></View>
    <SpringPressable accessibilityRole="button" accessibilityLabel={`Replay route for ${vehicle.device.name}`} onPress={onReplay} style={styles.replayAction}><MaterialCommunityIcons name="history" size={17} color={colors.cyan} /><Text style={styles.replayActionText}>Replay route</Text><Text style={styles.replayActionMeta}>last 24 hours</Text><MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} /></SpringPressable>
    {canControl ? <View style={styles.actionRow}>
      <Pressable disabled={sending || vehicle.state === 'offline'} onPress={() => command('engineResume')} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, (sending || vehicle.state === 'offline') && styles.disabled]}><MaterialCommunityIcons name="engine-outline" size={19} color={colors.lime} /><Text style={styles.actionText}>Restore</Text></Pressable>
      <Pressable disabled={sending || vehicle.state === 'offline'} onPress={() => command('engineStop')} style={({ pressed }) => [styles.actionButton, styles.stopAction, pressed && styles.pressed, (sending || vehicle.state === 'offline') && styles.disabled]}>{sending ? <ActivityIndicator size="small" color={colors.coral} /> : <MaterialCommunityIcons name="engine-off-outline" size={19} color={colors.coral} />}<Text style={[styles.actionText, { color: colors.coral }]}>Stop engine</Text></Pressable>
    </View> : <View style={styles.readOnly}><MaterialCommunityIcons name="shield-lock-outline" size={16} color={colors.muted} /><Text style={styles.readOnlyText}>Viewer access · remote controls are protected</Text></View>}
  </>;
}

function Telemetry({ icon, label, value, unit, accent = colors.text }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; value: string; unit?: string; accent?: string }) {
  return <View style={styles.telemetryCell}><MaterialCommunityIcons name={icon} size={15} color={colors.dim} /><Text style={styles.telemetryLabel}>{label}</Text><View style={styles.telemetryValueRow}><Text style={[styles.telemetryValue, { color: accent }]}>{value}</Text>{unit ? <Text style={styles.telemetryUnit}>{unit}</Text> : null}</View></View>;
}

function EmptyFleet() { return <View style={styles.emptyFleet}><View style={styles.emptyIcon}><MaterialCommunityIcons name="radar" size={30} color={colors.cyan} /></View><Text style={styles.emptyTitle}>Waiting for your fleet</Text><Text style={styles.emptyCopy}>Trackers will appear here as soon as they are connected to your Carva GPS account.</Text></View>; }

function FleetScreen({ vehicles, loading, refreshing, error, refresh, selected, favouriteIds, onPreview, onSelect }: ReturnType<typeof useFleet> & { selected?: Vehicle; favouriteIds: Set<number>; onPreview: (vehicle: Vehicle) => void; onSelect: (vehicle: Vehicle) => void }) {
  const [filter, setFilter] = useState<'all' | 'moving' | 'attention'>('all');
  const filtered = vehicles.filter((vehicle) => {
    if (filter === 'all') return true;
    if (filter === 'moving') return vehicle.state === 'moving';
    return vehicle.state === 'offline' || vehicle.state === 'unknown';
  });
  return <View style={styles.page}><View style={styles.pageHeader}><Text style={styles.pageKicker}>YOUR NETWORK</Text><Text style={styles.pageTitle}>Fleet pulse</Text><Text style={styles.pageSummary}>{vehicles.filter((v) => v.state === 'moving').length} moving · {vehicles.length} total units</Text></View>
    <View style={styles.filterRow}>{([['all', 'All units'], ['moving', 'Moving'], ['attention', 'Attention']] as const).map(([value, label]) => <Pressable key={value} style={[styles.filter, filter === value && styles.filterActive]} onPress={() => setFilter(value)}><Text style={[styles.filterText, filter === value && styles.filterTextActive]}>{label}</Text></Pressable>)}</View>
    {error ? <Text style={styles.pageError}>Live connection: {error}</Text> : null}
    <FlatList data={filtered} keyExtractor={(item) => String(item.device.id)} contentContainerStyle={styles.fleetList} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh(true)} tintColor={colors.lime} />} ListEmptyComponent={loading ? <FleetLoadingSkeleton /> : <EmptyFleet />} renderItem={({ item }) => <VehicleRow vehicle={item} favourite={favouriteIds.has(item.device.id)} selected={item.device.id === selected?.device.id} onLongPress={() => onPreview(item)} onPress={() => onSelect(item)} />} />
  </View>;
}

function VehicleRow({ vehicle, favourite, selected, onPress, onLongPress }: { vehicle: Vehicle; favourite: boolean; selected: boolean; onPress: () => void; onLongPress: () => void }) {
  const tone = toneFor(vehicle.state);
  return <SpringPressable accessibilityRole="button" accessibilityLabel={`${vehicle.device.name}, ${stateLabel(vehicle.state)}. Long press for quick actions.`} onPress={onPress} onLongPress={() => { haptics.medium(); onLongPress(); }} style={[styles.vehicleRow, selected && styles.vehicleRowSelected]}><View style={[styles.rowGlyph, { backgroundColor: `${tone}1C` }]}><MaterialCommunityIcons name={iconFor(vehicle)} size={22} color={tone} /></View><View style={styles.rowMain}><View style={styles.rowNameLine}><Text style={styles.rowName} numberOfLines={1}>{vehicle.device.name}</Text><Text style={[styles.rowState, { color: tone }]}>{stateLabel(vehicle.state)}</Text></View><Text style={styles.rowAddress} numberOfLines={1}>{vehicle.position?.address || vehicle.device.uniqueId}</Text><View style={styles.rowStats}><Text style={styles.rowStat}>{vehicle.speedKmh} km/h</Text><Text style={styles.rowSep}>·</Text><Text style={styles.rowStat}>{timeAgo(vehicle.position?.fixTime || vehicle.device.lastUpdate)}</Text></View></View>{favourite ? <MaterialCommunityIcons name="star" size={17} color={colors.amber} /> : null}<MaterialCommunityIcons name="chevron-right" size={22} color={colors.dim} /></SpringPressable>;
}

function ReplayScreen({ vehicles, selected, onSelect }: { vehicles: Vehicle[]; selected?: Vehicle; onSelect: (vehicle: Vehicle) => void }) {
  const [hours, setHours] = useState(24);
  const [trackWidth, setTrackWidth] = useState(1);
  const replay = useRouteReplay(selected?.device.id, hours);
  const marker = replay.activePoint || selected?.position;
  const region: Region = marker ? { latitude: marker.latitude, longitude: marker.longitude, latitudeDelta: 0.055, longitudeDelta: 0.055 } : DEFAULT_REGION;
  const pickProgress = (locationX: number) => {
    if (replay.points.length < 2) return;
    replay.setPlaying(false);
    replay.setIndex(Math.max(0, Math.min(replay.points.length - 1, Math.round((locationX / trackWidth) * (replay.points.length - 1)))));
  };
  return <View style={styles.replayPage}>
    <MapView style={StyleSheet.absoluteFill} initialRegion={region} customMapStyle={mapStyle as never} showsCompass={false} toolbarEnabled={false} rotateEnabled={false}>
      {replay.points.length > 1 ? <Polyline coordinates={replay.points.map((point) => ({ latitude: point.latitude, longitude: point.longitude }))} strokeColor={colors.cyan} strokeWidth={4} lineCap="round" lineJoin="round" /> : null}
      {marker ? <Marker coordinate={{ latitude: marker.latitude, longitude: marker.longitude }} anchor={{ x: .5, y: .5 }} tracksViewChanges={false}><View style={styles.replayMarker}><MaterialCommunityIcons name="car-sports" size={18} color={colors.ink} /></View></Marker> : null}
    </MapView>
    <LinearGradient colors={[colors.ink, 'rgba(7,16,31,.42)', 'transparent']} locations={[0, .6, 1]} style={styles.topFade} pointerEvents="none" />
    <GlassSurface style={styles.replayHeader} intensity={48}>
      <MaterialCommunityIcons name="history" size={20} color={colors.cyan} />
      <View style={{ flex: 1 }}><Text style={styles.replayEyebrow}>ROUTE REPLAY</Text><Text style={styles.replayTitle} numberOfLines={1}>{selected?.device.name || 'Choose a vehicle'}</Text></View>
      <SpringPressable accessibilityRole="button" accessibilityLabel="Refresh route replay" onPress={() => { haptics.light(); replay.refresh(); }} style={styles.replayRefresh}><MaterialCommunityIcons name="refresh" size={19} color={colors.text} /></SpringPressable>
    </GlassSurface>
    <View style={styles.replaySheet}>
      <View style={styles.sheetHandle} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.replayVehiclePicker}>
        {vehicles.map((vehicle) => <SpringPressable key={vehicle.device.id} accessibilityRole="button" accessibilityLabel={`Replay ${vehicle.device.name}`} onPress={() => onSelect(vehicle)} style={[styles.replayVehicle, vehicle.device.id === selected?.device.id && styles.replayVehicleActive]}><Text style={[styles.replayVehicleText, vehicle.device.id === selected?.device.id && styles.replayVehicleTextActive]} numberOfLines={1}>{vehicle.device.name}</Text></SpringPressable>)}
      </ScrollView>
      <View style={styles.rangeRow}>{([1, 6, 24] as const).map((value) => <SpringPressable key={value} accessibilityRole="button" accessibilityLabel={`Show the last ${value} hours`} onPress={() => setHours(value)} style={[styles.rangeButton, hours === value && styles.rangeButtonActive]}><Text style={[styles.rangeText, hours === value && styles.rangeTextActive]}>{value}H</Text></SpringPressable>)}</View>
      {replay.loading ? <View style={styles.replayLoading}><ActivityIndicator color={colors.cyan} /><Text style={styles.replayLoadingText}>Building route replay…</Text></View> : replay.error ? <View style={styles.replayLoading}><MaterialCommunityIcons name="alert-circle-outline" size={20} color={colors.amber} /><Text style={styles.replayLoadingText}>Route history could not load</Text></View> : replay.points.length < 2 ? <View style={styles.replayLoading}><MaterialCommunityIcons name="map-marker-question-outline" size={20} color={colors.muted} /><Text style={styles.replayLoadingText}>No recorded route for this period</Text></View> : <>
        <View style={styles.replayStats}><View><Text style={styles.replayStatValue}>{replay.points.length}</Text><Text style={styles.replayStatLabel}>GPS POINTS</Text></View><View><Text style={styles.replayStatValue}>{formatReplayTime(replay.activePoint?.fixTime)}</Text><Text style={styles.replayStatLabel}>PLAYHEAD</Text></View><View><Text style={styles.replayStatValue}>{selected?.speedKmh || 0} <Text style={styles.replayStatUnit}>km/h</Text></Text><Text style={styles.replayStatLabel}>CURRENT</Text></View></View>
        <View style={styles.replayControls}><SpringPressable accessibilityRole="button" accessibilityLabel={replay.playing ? 'Pause replay' : 'Play replay'} onPress={() => { haptics.selection(); replay.setPlaying(!replay.playing); }} style={styles.replayPlay}><MaterialCommunityIcons name={replay.playing ? 'pause' : 'play'} size={22} color={colors.ink} /></SpringPressable><Pressable accessibilityRole="adjustable" accessibilityLabel="Replay progress" onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)} onPress={(event) => pickProgress(event.nativeEvent.locationX)} style={styles.progressTrack}><View style={[styles.progressFill, { width: `${replay.progress * 100}%` }]} /><View style={[styles.progressKnob, { left: `${replay.progress * 100}%` }]} /></Pressable></View>
      </>}
    </View>
  </View>;
}

function formatReplayTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(+date) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function AlertsScreen({ alerts, onSelect }: { alerts: FleetAlert[]; onSelect: (vehicle: Vehicle) => void }) {
  return <ScrollView style={styles.page} contentContainerStyle={styles.alertPage}><View style={styles.pageHeader}><Text style={styles.pageKicker}>SIGNAL DESK</Text><Text style={styles.pageTitle}>Needs your eye</Text><Text style={styles.pageSummary}>{alerts.length ? `${alerts.length} live item${alerts.length === 1 ? '' : 's'} to review` : 'Everything is looking calm'}</Text></View>{alerts.length ? alerts.map((alert) => <AlertCard key={alert.id} alert={alert} onPress={() => onSelect(alert.vehicle)} />) : <View style={styles.allClear}><View style={styles.allClearIcon}><MaterialCommunityIcons name="shield-check-outline" size={40} color={colors.mint} /></View><Text style={styles.emptyTitle}>All clear</Text><Text style={styles.emptyCopy}>There are no vehicle, battery, or signal issues demanding attention right now.</Text></View>}</ScrollView>;
}

function AlertCard({ alert, onPress }: { alert: FleetAlert; onPress: () => void }) {
  const color = alert.kind === 'offline' ? colors.coral : alert.kind === 'speed' ? colors.amber : alert.kind === 'battery' ? colors.purple : colors.cyan;
  const icon = alert.kind === 'offline' ? 'wifi-strength-off-outline' : alert.kind === 'speed' ? 'speedometer' : alert.kind === 'battery' ? 'battery-alert-variant-outline' : 'crosshairs-question';
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.alertCard, pressed && styles.pressed]}><View style={[styles.alertIcon, { backgroundColor: `${color}20` }]}><MaterialCommunityIcons name={icon} size={23} color={color} /></View><View style={styles.alertCopy}><Text style={styles.alertTitle}>{alert.title}</Text><Text style={styles.alertDetail}>{alert.detail}</Text><Text style={styles.alertTime}>{timeAgo(alert.time)}</Text></View><MaterialCommunityIcons name="arrow-top-right" size={19} color={colors.dim} /></Pressable>;
}

function ProfileScreen({ user, fleet, onLogout }: { user: SessionUser; fleet: Vehicle[]; onLogout: () => void }) {
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return <ScrollView style={styles.page} contentContainerStyle={styles.profilePage}><View style={styles.pageHeader}><Text style={styles.pageKicker}>COMMANDER PROFILE</Text><Text style={styles.pageTitle}>You’re connected</Text></View><View style={styles.profileHero}><View style={styles.avatar}><Text style={styles.avatarText}>{initials || 'C'}</Text></View><View><Text style={styles.profileName}>{user.name}</Text><Text style={styles.profileEmail}>{user.email}</Text><View style={styles.rolePill}><Text style={styles.roleText}>{user.role.replace('_', ' ')}</Text></View></View></View><View style={styles.profileMetrics}><Metric value={String(fleet.length)} label="TRACKERS" /><Metric value={String(fleet.filter((v) => v.state === 'moving').length)} label="IN MOTION" /><Metric value="5s" label="LIVE SYNC" /></View><Text style={styles.settingSection}>PULSE SETTINGS</Text><View style={styles.settingCard}><Setting icon="theme-light-dark" label="Command center" detail="Midnight interface" /><Setting icon="bell-outline" label="Live alerts" detail="Vehicle & tracker signals" /><Setting icon="clock-outline" label="Timezone" detail="Baghdad · Asia/Baghdad" /></View><Pressable onPress={onLogout} style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}><MaterialCommunityIcons name="logout" size={20} color={colors.coral} /><Text style={styles.signOutText}>Sign out from Carva</Text></Pressable><Text style={styles.version}>CARVA PULSE · iOS & ANDROID</Text></ScrollView>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.profileMetric}><Text style={styles.profileMetricValue}>{value}</Text><Text style={styles.profileMetricLabel}>{label}</Text></View>; }
function Setting({ icon, label, detail }: { icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; detail: string }) { return <View style={styles.setting}><View style={styles.settingIcon}><MaterialCommunityIcons name={icon} size={20} color={colors.cyan} /></View><View><Text style={styles.settingLabel}>{label}</Text><Text style={styles.settingDetail}>{detail}</Text></View></View>; }

function BottomNav({ active, alertCount, onChange }: { active: Tab; alertCount: number; onChange: (tab: Tab) => void }) {
  const items: { id: Tab; label: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }[] = [{ id: 'pulse', label: 'Pulse', icon: 'radar' }, { id: 'fleet', label: 'Fleet', icon: 'car-multiple' }, { id: 'replay', label: 'Replay', icon: 'history' }, { id: 'alerts', label: 'Alerts', icon: 'bell-outline' }, { id: 'profile', label: 'Profile', icon: 'account-circle-outline' }];
  return <GlassSurface style={styles.nav} intensity={52}>{items.map((item) => { const selected = active === item.id; return <SpringPressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label} onPress={() => { haptics.selection(); onChange(item.id); }} style={styles.navItem}><View style={[styles.navIcon, selected && styles.navIconActive]}><MaterialCommunityIcons name={item.icon} size={22} color={selected ? colors.ink : colors.muted} />{item.id === 'alerts' && alertCount > 0 ? <View style={styles.navBadge}><Text style={styles.navBadgeText}>{Math.min(alertCount, 9)}</Text></View> : null}</View><Text style={[styles.navLabel, selected && styles.navLabelActive]}>{item.label}</Text></SpringPressable>; })}</GlassSurface>;
}

function toneFor(state: VehicleState) { return ({ moving: colors.lime, idling: colors.amber, stopped: colors.cyan, offline: colors.coral, unknown: colors.purple })[state]; }
function iconFor(vehicle: Vehicle): React.ComponentProps<typeof MaterialCommunityIcons>['name'] { const name = `${vehicle.device.category || ''} ${vehicle.device.name}`.toLowerCase(); if (name.includes('truck')) return 'truck-fast-outline'; if (name.includes('bus')) return 'bus'; if (name.includes('motor') || name.includes('bike')) return 'motorbike'; return 'car-sports'; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ink }, splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink }, brandMark: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime, transform: [{ rotate: '-10deg' }] }, brandArrow: { color: colors.ink, fontSize: 30, lineHeight: 31, fontWeight: '900' }, splashName: { marginTop: 18, color: colors.text, letterSpacing: 3, fontSize: 16, fontWeight: '800' }, splashAccent: { color: colors.lime },
  loginSafe: { flex: 1, backgroundColor: colors.ink }, loginGlowA: { position: 'absolute', width: 250, height: 250, borderRadius: 125, backgroundColor: '#225D78', opacity: .24, top: -75, right: -75 }, loginGlowB: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: colors.lime, opacity: .07, bottom: 100, left: -50 }, loginContent: { padding: 25, paddingTop: 35, flexGrow: 1 }, loginBrand: { flexDirection: 'row', alignItems: 'center', gap: 12 }, loginBrandText: { color: colors.text, fontWeight: '900', letterSpacing: 2.3, fontSize: 14 }, loginHero: { marginTop: 74 }, kicker: { color: colors.cyan, letterSpacing: 1.8, fontSize: 10, fontWeight: '800' }, loginTitle: { marginTop: 14, fontSize: 37, letterSpacing: -1.35, lineHeight: 43, color: colors.text, fontWeight: '800' }, loginCopy: { marginTop: 17, color: colors.muted, lineHeight: 22, maxWidth: 320, fontSize: 15 }, loginCard: { marginTop: 'auto', padding: 20, borderRadius: 25, backgroundColor: 'rgba(14,31,57,0.88)', borderWidth: 1, borderColor: colors.lineStrong }, cardEyebrow: { fontSize: 10, color: colors.muted, fontWeight: '800', letterSpacing: 1.4, marginBottom: 18 }, inputLabel: { fontSize: 12, color: colors.text, marginBottom: 8, fontWeight: '600' }, input: { backgroundColor: '#071426', borderColor: colors.line, borderWidth: 1, borderRadius: 13, height: 50, paddingHorizontal: 14, color: colors.text, fontSize: 15, marginBottom: 15 }, formError: { color: colors.coral, fontSize: 12, lineHeight: 17, marginBottom: 11 }, loginButton: { height: 53, borderRadius: 14, backgroundColor: colors.lime, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 }, loginButtonText: { color: colors.ink, fontWeight: '800', fontSize: 15 }, loginFine: { color: colors.dim, textAlign: 'center', fontSize: 11, lineHeight: 16, marginTop: 20, paddingHorizontal: 22 },
  command: { flex: 1, backgroundColor: colors.ink }, topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 182 }, commandTop: { position: 'absolute', top: 18, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, commandOverline: { color: colors.text, fontSize: 13, letterSpacing: 2.1, fontWeight: '900' }, liveRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.lime, marginRight: 6 }, liveText: { color: colors.lime, fontWeight: '800', fontSize: 10, letterSpacing: 1.25 }, liveSub: { color: colors.muted, fontSize: 10 }, roundButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,16,31,.88)', borderWidth: 1, borderColor: colors.lineStrong }, notificationDot: { position: 'absolute', minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 9, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center', right: -3, top: -3 }, notificationText: { color: colors.ink, fontSize: 9, fontWeight: '900' }, mapTools: { position: 'absolute', right: 17, top: 83, gap: 9 }, tool: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,16,31,.9)', borderWidth: 1, borderColor: colors.lineStrong }, connectionBanner: { position: 'absolute', left: 18, right: 18, top: 139, borderRadius: 12, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#392A1B', borderWidth: 1, borderColor: '#6D5229' }, connectionText: { color: colors.amber, fontSize: 12, fontWeight: '600' }, markerHalo: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,.45)', backgroundColor: 'rgba(7,16,31,.65)' }, markerCore: { width: 31, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.ink }, mapSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, minHeight: 291, padding: 17, paddingTop: 9, paddingBottom: 14, borderTopLeftRadius: 29, borderTopRightRadius: 29, backgroundColor: '#0C1830', borderTopWidth: 1, borderColor: colors.lineStrong }, sheetHandle: { alignSelf: 'center', width: 37, height: 4, borderRadius: 3, backgroundColor: colors.lineStrong, marginBottom: 14 }, sheetHeading: { flexDirection: 'row', alignItems: 'center', gap: 11 }, vehicleGlyph: { width: 45, height: 45, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, vehicleName: { flex: 1, minWidth: 0 }, vehicleTitle: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -.3 }, vehicleMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 }, stateDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 }, stateText: { fontSize: 11, fontWeight: '800' }, muted: { color: colors.muted, fontSize: 11 }, switchVehicle: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inkSoft, borderWidth: 1, borderColor: colors.line }, telemetry: { marginTop: 18, borderRadius: 16, borderWidth: 1, borderColor: colors.lineStrong, overflow: 'hidden', backgroundColor: colors.ink, flexDirection: 'row' }, telemetryCell: { flex: 1, minHeight: 77, padding: 10, borderRightWidth: 1, borderColor: colors.line }, telemetryLabel: { color: colors.dim, fontSize: 9, marginTop: 3, letterSpacing: .8, fontWeight: '800' }, telemetryValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 }, telemetryValue: { color: colors.text, fontSize: 17, fontWeight: '800' }, telemetryUnit: { fontSize: 9, color: colors.muted, marginLeft: 3 }, address: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 13, paddingHorizontal: 3 }, addressText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 15 }, replayAction: { minHeight: 38, borderRadius: 11, marginTop: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(21, 47, 76, .8)', borderWidth: 1, borderColor: 'rgba(108, 222, 255, .3)' }, replayActionText: { color: colors.cyan, fontSize: 12, fontWeight: '800' }, replayActionMeta: { flex: 1, textAlign: 'right', color: colors.muted, fontSize: 10, fontWeight: '600' }, actionRow: { flexDirection: 'row', gap: 9, marginTop: 10 }, actionButton: { flex: 1, height: 41, backgroundColor: colors.ink, borderRadius: 12, borderWidth: 1, borderColor: `${colors.lime}55`, alignItems: 'center', justifyContent: 'center', gap: 7, flexDirection: 'row' }, stopAction: { borderColor: `${colors.coral}55` }, actionText: { color: colors.lime, fontWeight: '800', fontSize: 12 }, readOnly: { minHeight: 41, marginTop: 10, borderRadius: 12, paddingHorizontal: 12, alignItems: 'center', flexDirection: 'row', gap: 7, backgroundColor: colors.ink, borderWidth: 1, borderColor: colors.line }, readOnlyText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, emptyFleet: { alignItems: 'center', paddingHorizontal: 28, paddingVertical: 15 }, emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: `${colors.cyan}18`, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }, emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800' }, emptyCopy: { color: colors.muted, textAlign: 'center', fontSize: 13, lineHeight: 19, marginTop: 8 },
  page: { flex: 1, backgroundColor: colors.ink }, pageHeader: { padding: 22, paddingBottom: 15 }, pageKicker: { color: colors.cyan, fontSize: 10, letterSpacing: 1.5, fontWeight: '900' }, pageTitle: { marginTop: 7, color: colors.text, fontSize: 30, letterSpacing: -1, fontWeight: '800' }, pageSummary: { marginTop: 5, color: colors.muted, fontSize: 13 }, filterRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 }, filter: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 11, backgroundColor: colors.inkSoft, borderWidth: 1, borderColor: colors.line }, filterActive: { backgroundColor: colors.lime, borderColor: colors.lime }, filterText: { color: colors.muted, fontSize: 12, fontWeight: '700' }, filterTextActive: { color: colors.ink }, pageError: { marginHorizontal: 20, color: colors.amber, fontSize: 12 }, fleetList: { padding: 15, paddingTop: 7, paddingBottom: 105, gap: 9 }, vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 12, backgroundColor: colors.inkRaised, borderWidth: 1, borderColor: colors.line }, vehicleRowSelected: { borderColor: `${colors.lime}80` }, rowGlyph: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, rowMain: { flex: 1, minWidth: 0 }, rowNameLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }, rowName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' }, rowState: { fontSize: 10, fontWeight: '800' }, rowAddress: { color: colors.muted, fontSize: 11, marginTop: 3 }, rowStats: { flexDirection: 'row', gap: 5, marginTop: 5 }, rowStat: { color: colors.dim, fontSize: 10, fontWeight: '600' }, rowSep: { color: colors.dim, fontSize: 10 },
  replayPage: { flex: 1, backgroundColor: colors.ink }, replayHeader: { position: 'absolute', left: 15, right: 15, top: 13, minHeight: 60, borderRadius: 19, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, replayEyebrow: { color: colors.cyan, fontSize: 9, letterSpacing: 1.2, fontWeight: '900' }, replayTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 2 }, replayRefresh: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(7,16,31,.6)' }, replayMarker: { width: 37, height: 37, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime, borderWidth: 3, borderColor: colors.ink }, replaySheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 9, paddingBottom: 99, borderTopLeftRadius: 29, borderTopRightRadius: 29, backgroundColor: '#0C1830', borderTopWidth: 1, borderColor: colors.lineStrong }, replayVehiclePicker: { gap: 7, paddingHorizontal: 16, paddingBottom: 13 }, replayVehicle: { maxWidth: 136, paddingHorizontal: 12, height: 31, borderRadius: 10, justifyContent: 'center', backgroundColor: colors.inkSoft, borderWidth: 1, borderColor: colors.line }, replayVehicleActive: { backgroundColor: colors.lime, borderColor: colors.lime }, replayVehicleText: { color: colors.muted, fontSize: 11, fontWeight: '700' }, replayVehicleTextActive: { color: colors.ink }, rangeRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 16, paddingBottom: 13 }, rangeButton: { flex: 1, height: 32, borderRadius: 10, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line }, rangeButtonActive: { backgroundColor: `${colors.cyan}22`, borderColor: `${colors.cyan}88` }, rangeText: { color: colors.muted, fontSize: 11, fontWeight: '800' }, rangeTextActive: { color: colors.cyan }, replayLoading: { minHeight: 88, alignItems: 'center', justifyContent: 'center', gap: 9 }, replayLoadingText: { color: colors.muted, fontSize: 12, fontWeight: '600' }, replayStats: { paddingHorizontal: 20, paddingBottom: 13, flexDirection: 'row', justifyContent: 'space-between' }, replayStatValue: { color: colors.text, fontSize: 16, fontWeight: '900' }, replayStatUnit: { color: colors.muted, fontSize: 9 }, replayStatLabel: { color: colors.dim, fontSize: 8, letterSpacing: .7, fontWeight: '900', marginTop: 3 }, replayControls: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, replayPlay: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lime }, progressTrack: { flex: 1, height: 32, justifyContent: 'center' }, progressFill: { position: 'absolute', left: 0, height: 4, borderRadius: 4, backgroundColor: colors.cyan }, progressKnob: { position: 'absolute', width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: colors.text, borderWidth: 3, borderColor: colors.cyan },
  alertPage: { paddingBottom: 110 }, alertCard: { marginHorizontal: 16, marginBottom: 9, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.inkRaised, flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, alertIcon: { width: 43, height: 43, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }, alertCopy: { flex: 1 }, alertTitle: { color: colors.text, fontWeight: '800', fontSize: 14 }, alertDetail: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, alertTime: { color: colors.dim, fontSize: 10, marginTop: 6, fontWeight: '600' }, allClear: { margin: 20, alignItems: 'center', paddingTop: 64 }, allClearIcon: { width: 78, height: 78, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: `${colors.mint}16`, marginBottom: 17 },
  profilePage: { paddingBottom: 112 }, profileHero: { margin: 17, marginTop: 0, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 21, backgroundColor: colors.inkRaised, borderWidth: 1, borderColor: colors.line }, avatar: { width: 55, height: 55, borderRadius: 19, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.lime }, avatarText: { color: colors.ink, fontSize: 18, fontWeight: '900' }, profileName: { color: colors.text, fontSize: 17, fontWeight: '800' }, profileEmail: { color: colors.muted, fontSize: 12, marginTop: 3 }, rolePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, backgroundColor: `${colors.cyan}18`, borderRadius: 6, marginTop: 7 }, roleText: { color: colors.cyan, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' }, profileMetrics: { marginHorizontal: 17, flexDirection: 'row', borderRadius: 19, backgroundColor: colors.inkSoft, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, profileMetric: { flex: 1, padding: 14, alignItems: 'center', borderRightWidth: 1, borderColor: colors.line }, profileMetricValue: { color: colors.lime, fontSize: 19, fontWeight: '900' }, profileMetricLabel: { color: colors.dim, fontSize: 8, letterSpacing: .8, fontWeight: '900', marginTop: 5 }, settingSection: { margin: 23, marginBottom: 9, color: colors.dim, fontSize: 10, letterSpacing: 1.4, fontWeight: '900' }, settingCard: { marginHorizontal: 17, borderRadius: 19, backgroundColor: colors.inkRaised, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, setting: { minHeight: 67, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderColor: colors.line }, settingIcon: { height: 38, width: 38, borderRadius: 12, backgroundColor: `${colors.cyan}14`, justifyContent: 'center', alignItems: 'center' }, settingLabel: { color: colors.text, fontSize: 13, fontWeight: '700' }, settingDetail: { color: colors.muted, fontSize: 11, marginTop: 3 }, signOut: { margin: 17, height: 51, borderRadius: 15, borderWidth: 1, borderColor: `${colors.coral}55`, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }, signOutText: { color: colors.coral, fontSize: 13, fontWeight: '800' }, version: { color: colors.dim, textAlign: 'center', fontSize: 9, letterSpacing: 1.2, fontWeight: '700', marginTop: 4 },
  nav: { height: 82, position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, paddingBottom: 11, borderTopLeftRadius: 23, borderTopRightRadius: 23 }, navItem: { alignItems: 'center', justifyContent: 'center', width: 60, gap: 3 }, navIcon: { width: 39, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, navIconActive: { backgroundColor: colors.lime }, navLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' }, navLabelActive: { color: colors.lime }, navBadge: { position: 'absolute', backgroundColor: colors.coral, minWidth: 14, height: 14, borderRadius: 7, top: -3, right: -2, alignItems: 'center', justifyContent: 'center' }, navBadgeText: { color: colors.ink, fontSize: 8, fontWeight: '900' }, pressed: { opacity: .72, transform: [{ scale: .98 }] }, disabled: { opacity: .45 },
});

export default App;
