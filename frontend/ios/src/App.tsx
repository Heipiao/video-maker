import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  ImageSourcePropType,
  Modal,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {getFocusedRouteNameFromRoute} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator, NativeStackScreenProps} from '@react-navigation/native-stack';
import {errorCodes, isErrorWithCode, pick, types as documentTypes} from '@react-native-documents/picker';
import {launchImageLibrary} from 'react-native-image-picker';
import Video from 'react-native-video';

import {
  AdvisorOption,
  Asset,
  createAdvisorOptions,
  createProjectFinalRender,
  createProjectPreviewRender,
  createVideoProject,
  DemoAsset,
  fetchCatalog,
  fetchDemoAssets,
  generateVideoSpec,
  getProjectByInviteCode,
  getProjectFinalPlayback,
  getProjectPreviewPlayback,
  getRenderJob,
  getRenderJobPlayback,
  linkProjectAsset,
  listProjectAssets,
  modifyVideoProject,
  normalizeLocalExportUrl,
  registerAsset,
  RenderJob,
  saveVideoSpec,
  startConfiguredRender,
  Template,
  updateAsset,
  updateVideoProject,
  uploadFile,
  unlinkProjectAsset,
  verifyApplePurchase,
  VideoSpec,
  VideoProject,
} from './api/client';

type RootTabs = {
  Create: undefined;
  'My Reel': undefined;
  Settings: undefined;
};

type CreateStackParams = {
  CreateHome: undefined;
  GuestInvite: undefined;
  GuestUpload: undefined;
  PhotoWall: undefined;
  Tagging: {assetId: string};
  AudioPicker: undefined;
  Interview: undefined;
  RenderingResult: undefined;
};

type WeddingDetails = {
  coupleNames: string;
  weddingDate: string;
  location: string;
};

type LocalAsset = {
  id: string;
  uri: string;
  type: 'photo' | 'video' | 'music';
  tag: string;
  tags: string[];
  width?: number;
  height?: number;
  caption?: string;
  description?: string;
};

type LocalExport = {
  fileUri: string;
  fileName?: string;
  saved?: boolean;
};

type StoreProduct = {
  id: string;
  title: string;
  description: string;
  price: string;
};

type StorePurchase = {
  product_id: string;
  transaction_id: string;
  original_transaction_id: string;
};

type InterviewAnswer = {
  questionId: string;
  question: string;
  answer: string;
};

type StylePresetId = 'nostalgia_editorial' | 'reels_party_cut' | 'clean_film_trailer' | 'guest_pov_recap';

const STYLE_PRESET_CHOICES: Array<{id: StylePresetId; label: string; filter: string; color: string}> = [
  {id: 'nostalgia_editorial', label: 'Nostalgia', filter: 'warm_grain', color: '#D83A52'},
  {id: 'reels_party_cut', label: 'Party', filter: 'reels_pop', color: '#E43F5A'},
  {id: 'clean_film_trailer', label: 'Film', filter: 'clean_bw', color: '#F4F1EA'},
  {id: 'guest_pov_recap', label: 'Guest POV', filter: 'camera_roll', color: '#D83A52'},
];

type RenderStage = 'idle' | 'story' | 'beats' | 'provisioning' | 'rendering' | 'uploading' | 'ready' | 'failed';
type UnlockStage = 'idle' | 'purchasing' | 'provisioning' | 'rendering' | 'uploading' | 'ready' | 'failed';

type VowFrameExportModuleType = {
  downloadExport: (url: string) => Promise<LocalExport>;
  saveVideoToPhotos: (url: string) => Promise<LocalExport>;
  fetchStoreProducts?: (productIds: string[]) => Promise<StoreProduct[]>;
  purchaseProduct?: (productId: string) => Promise<StorePurchase>;
};

const VowFrameExportModule = NativeModules.VowFrameExportModule as VowFrameExportModuleType | undefined;

const IAP_PRODUCTS = [
  {
    id: 'com.aigcteacher.vowframeapp.singleexport',
    label: 'Single Export',
    shortLabel: 'Single',
    fallbackPrice: '$9.99',
    description: 'Export one watermark-free HD reel.',
  },
  {
    id: 'com.aigcteacher.vowframeapp.exportpack',
    label: 'Wedding Export Pack',
    shortLabel: 'Pack',
    fallbackPrice: '$19.99',
    description: 'Export 10 watermark-free HD reels for this wedding.',
  },
] as const;

type IapProductId = (typeof IAP_PRODUCTS)[number]['id'];

function fallbackDebugPurchase(productId: IapProductId) {
  const transactionId = `local-test-${productId.split('.').pop()}-${Date.now()}`;
  return {
    product_id: productId,
    transaction_id: transactionId,
    original_transaction_id: transactionId,
  };
}

async function purchaseIapProduct(productId: IapProductId) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    try {
      if (VowFrameExportModule?.purchaseProduct) {
        return await VowFrameExportModule.purchaseProduct(productId);
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (!message.includes('product_unavailable') && !message.includes('products_request_failed')) {
        throw caught;
      }
    }
    return fallbackDebugPurchase(productId);
  }
  if (VowFrameExportModule?.purchaseProduct) {
    return VowFrameExportModule.purchaseProduct(productId);
  }
  throw new Error('In-app purchases are not available in this build.');
}

function useStoreProducts(enabled: boolean) {
  const [storeProducts, setStoreProducts] = useState<StoreProduct[]>([]);

  useEffect(() => {
    if (!enabled || !VowFrameExportModule?.fetchStoreProducts) {
      return;
    }

    let cancelled = false;
    VowFrameExportModule.fetchStoreProducts(IAP_PRODUCTS.map(product => product.id))
      .then(products => {
        if (!cancelled) {
          setStoreProducts(products);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStoreProducts([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return storeProducts;
}

const Tab = createBottomTabNavigator<RootTabs>();
const Stack = createNativeStackNavigator<CreateStackParams>();

const UI = {
  bg: '#F8F8F5',
  surface: '#FFFFFF',
  ink: '#0E0E10',
  muted: '#686763',
  line: '#DEDED8',
  dark: '#121214',
  rose: '#D83A52',
  roseSoft: '#F7E7EA',
  roseInk: '#8E1930',
  chrome: '#E8E8E2',
};

const UI_ASSETS: Record<string, ImageSourcePropType> = {
  homePoster: require('./assets/vowframe-ui/home-reel-poster.png'),
  emptyPhotoWall: require('./assets/vowframe-ui/empty-wall-photo.png'),
  previewPlaceholder: require('./assets/vowframe-ui/preview-placeholder.png'),
};
const HOME_REEL_VIDEO = require('./assets/vowframe-ui/home-reel-loop.mp4');
type IconName = 'camera' | 'tag' | 'sound' | 'export' | 'noWatermark' | 'reelsReady' | 'moments' | 'reels' | 'settings';
type UploadProgress = {current: number; total: number; label: string};
const ICON_ASSETS: Record<IconName | 'check', ImageSourcePropType> = {
  camera: require('./assets/vowframe-ui/generated-icons/icon-camera-roll-ai.png'),
  tag: require('./assets/vowframe-ui/generated-icons/icon-tag-ai.png'),
  sound: require('./assets/vowframe-ui/generated-icons/icon-sound-ai.png'),
  export: require('./assets/vowframe-ui/generated-icons/icon-hd-export-ai.png'),
  noWatermark: require('./assets/vowframe-ui/generated-icons/icon-no-watermark-ai.png'),
  reelsReady: require('./assets/vowframe-ui/generated-icons/icon-reels-ready-ai.png'),
  moments: require('./assets/vowframe-ui/generated-icons/icon-moments-ai.png'),
  reels: require('./assets/vowframe-ui/generated-icons/icon-reels-ai.png'),
  settings: require('./assets/vowframe-ui/generated-icons/icon-settings-ai.png'),
  check: require('./assets/vowframe-ui/generated-icons/icon-check-vowframe.png'),
};

function renderMomentsTabIcon({focused}: {focused: boolean}) {
  return <TabGlyph name="moments" focused={focused} />;
}

function renderReelsTabIcon({focused}: {focused: boolean}) {
  return <TabGlyph name="reels" focused={focused} />;
}

function renderStudioTabIcon({focused}: {focused: boolean}) {
  return <TabGlyph name="settings" focused={focused} />;
}

const RECOMMENDED_TAGS = ['first look', 'vows', 'family', 'dance', 'details', 'rings', 'sunset'];
const INTERVIEW_STEPS = [
  {
    id: 'couple',
    question: 'What should the opening title say?',
    placeholder: 'Example: Emma and Noah',
    suggestions: ['Emma and Noah', 'The Parkers', 'Our wedding weekend'],
  },
  {
    id: 'style',
    question: 'Choose the cut style.',
    placeholder: 'Pick one style',
    suggestions: STYLE_PRESET_CHOICES.map(choice => choice.label),
  },
  {
    id: 'story',
    question: 'What moments have to make the cut?',
    placeholder: 'Example: vows, parents, dance floor, after-party',
    suggestions: ['Vows and family', 'Dance floor chaos', 'Details and outfits'],
  },
  {
    id: 'pacing',
    question: 'How should it move?',
    placeholder: 'Example: slow open, fast party finish',
    suggestions: ['Slow open, fast finish', 'Beat-cut all the way', 'Soft and cinematic'],
  },
];

type AppState = {
  templates: Template[];
  details: WeddingDetails;
  assets: Asset[];
  localAssets: LocalAsset[];
  advisorOptions: AdvisorOption[];
  selectedOptionId: string | null;
  selectedMusicAssetId: string | null;
  beatSyncEnabled: boolean;
  interviewAnswers: InterviewAnswer[];
  renderStage: RenderStage;
  spec: VideoSpec | null;
  project: VideoProject | null;
  renderJob: RenderJob | null;
  previewJob: RenderJob | null;
  finalJob: RenderJob | null;
  playbackUrl: string | null;
  playbackUrlExpiresAt: string | null;
  previewPlaybackUrl: string | null;
  previewPlaybackUrlExpiresAt: string | null;
  finalPlaybackUrl: string | null;
  finalPlaybackUrlExpiresAt: string | null;
  unlockStage: UnlockStage;
};

const initialState: AppState = {
  templates: [],
  details: {coupleNames: '', weddingDate: '', location: ''},
  assets: [],
  localAssets: [],
  advisorOptions: [],
  selectedOptionId: null,
  selectedMusicAssetId: null,
  beatSyncEnabled: true,
  interviewAnswers: [],
  renderStage: 'idle',
  spec: null,
  project: null,
  renderJob: null,
  previewJob: null,
  finalJob: null,
  playbackUrl: null,
  playbackUrlExpiresAt: null,
  previewPlaybackUrl: null,
  previewPlaybackUrlExpiresAt: null,
  finalPlaybackUrl: null,
  finalPlaybackUrlExpiresAt: null,
  unlockStage: 'idle',
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchCatalog()
      .then(catalog => setState(current => ({...current, templates: catalog.templates})))
      .catch(() => undefined);
  }, []);

  async function run<T>(task: () => Promise<T>, after?: (value: T) => void) {
    try {
      setBusy(true);
      const value = await task();
      after?.(value);
    } catch (error) {
      Alert.alert('Action failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  const appContext = useMemo(() => ({state, setState, busy, run}), [state, busy]);

  return (
    <AppContext.Provider value={appContext}>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: UI.ink,
            tabBarInactiveTintColor: UI.muted,
            tabBarLabelStyle: {fontSize: 11, fontWeight: '700'},
            tabBarStyle: {backgroundColor: UI.bg, borderTopColor: UI.line},
          }}>
          <Tab.Screen
            name="Create"
            component={CreateNavigator}
            options={({route}) => {
              const routeName = getFocusedRouteNameFromRoute(route) ?? 'CreateHome';
              return {
                tabBarLabel: 'Moments',
                tabBarIcon: renderMomentsTabIcon,
                tabBarStyle:
                  routeName === 'CreateHome'
                    ? {display: 'none'}
                    : routeName === 'PhotoWall'
                    ? {backgroundColor: UI.bg, borderTopColor: UI.line}
                    : {display: 'none'},
              };
            }}
          />
          <Tab.Screen
            name="My Reel"
            component={MyReelScreen}
            options={{tabBarLabel: 'Reels', tabBarIcon: renderReelsTabIcon}}
          />
          <Tab.Screen
            name="Settings"
            component={SettingsScreen}
            options={{tabBarLabel: 'Settings', tabBarIcon: renderStudioTabIcon}}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </AppContext.Provider>
  );
}

const AppContext = React.createContext<{
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  busy: boolean;
  run: <T>(task: () => Promise<T>, after?: (value: T) => void) => Promise<void>;
} | null>(null);

function useAppState() {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error('Missing app context');
  }
  return context;
}

function CreateNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: UI.bg},
        headerTintColor: UI.ink,
        contentStyle: {backgroundColor: UI.bg},
      }}>
      <Stack.Screen name="CreateHome" component={CreateHomeScreen} options={{headerShown: false}} />
      <Stack.Screen name="GuestInvite" component={GuestInviteScreen} options={{title: 'Guest drop'}} />
      <Stack.Screen name="GuestUpload" component={GuestUploadScreen} options={{title: 'Drop moments'}} />
      <Stack.Screen name="PhotoWall" component={PhotoWallScreen} options={{headerShown: false}} />
      <Stack.Screen name="Tagging" component={TaggingScreen} options={{title: 'Tag moment'}} />
      <Stack.Screen name="AudioPicker" component={AudioPickerScreen} options={{title: 'Sound'}} />
      <Stack.Screen name="Interview" component={InterviewScreen} options={{title: 'Reel direction'}} />
      <Stack.Screen name="RenderingResult" component={RenderingResultScreen} options={{headerShown: false}} />
    </Stack.Navigator>
  );
}

function CreateHomeScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'CreateHome'>) {
  const {setState, run, busy} = useAppState();
  const [inviteMode, setInviteMode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [homeVideoFailed, setHomeVideoFailed] = useState(false);

  function startVideo() {
    run(
      async () => createVideoProject({couple_names: 'Our Wedding'}),
      value => {
        setState(current => ({...initialState, templates: current.templates, project: value.project}));
        navigation.navigate('PhotoWall');
      },
    );
  }

  function lookupInvite() {
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert('Invite code needed', 'Enter the 6-character code from the couple.');
      return;
    }
    run(
      async () => getProjectByInviteCode(code),
      value => {
        setState(current => ({...current, project: value.project}));
        navigation.navigate('GuestUpload');
      },
    );
  }

  return (
    <View style={styles.homeSafe}>
      <View style={styles.homeFrame}>
        <Image source={UI_ASSETS.homePoster} style={styles.homeMedia} />
        {!homeVideoFailed ? (
          <Video
            source={HOME_REEL_VIDEO}
            style={styles.homeMedia}
            resizeMode="cover"
            muted
            repeat
            paused={false}
            controls={false}
            onError={() => setHomeVideoFailed(true)}
          />
        ) : null}
        <View pointerEvents="none" style={styles.homeScrim} />

        <View style={styles.homeTopBar}>
          <Text style={styles.homeWordmark}>vowframe</Text>
          <View style={styles.homeRecordDot} />
        </View>

        <View style={styles.homeActionPanel}>
          {inviteMode ? (
            <View style={styles.homeInviteStack}>
              <TextInput
                style={styles.homeInviteInput}
                value={inviteCode}
                onChangeText={value => setInviteCode(value.toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor="rgba(255,255,255,0.48)"
                autoCapitalize="characters"
                maxLength={6}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Join with invite code"
                style={[styles.homeButton, styles.homePrimaryButton, busy && styles.homeButtonDisabled]}
                onPress={lookupInvite}
                disabled={busy}>
                <Text style={styles.homePrimaryText}>{busy ? 'Checking' : 'Join'}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start a video"
                style={[styles.homeButton, styles.homeSecondaryButton]}
                onPress={startVideo}>
                <Text style={styles.homeSecondaryText}>Start a video</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.homeInviteStack}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Start a video"
                style={[styles.homeButton, styles.homePrimaryButton]}
                onPress={startVideo}>
                <Text style={styles.homePrimaryText}>Start a video</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enter invite code"
                style={[styles.homeButton, styles.homeSecondaryButton]}
                onPress={() => setInviteMode(true)}>
                <Text style={styles.homeSecondaryText}>Enter invite code</Text>
              </Pressable>
            </View>
          )}
          <View style={styles.homeHandleRow}>
            <View style={styles.homeHandle} />
          </View>
        </View>
      </View>
    </View>
  );
}

function GuestInviteScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'GuestInvite'>) {
  const {setState, run, busy} = useAppState();
  const [inviteCode, setInviteCode] = useState('');

  function lookupInvite() {
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert('Invite code needed', 'Enter the 6-character code from the couple.');
      return;
    }
    run(
      async () => getProjectByInviteCode(code),
      value => {
        setState(current => ({...current, project: value.project}));
        navigation.navigate('GuestUpload');
      },
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Drop the good clips</Text>
      <Text style={styles.subtle}>Enter the code from the couple. Your photos and videos land in their reel folder.</Text>
      <TextInput
        style={styles.inviteInput}
        value={inviteCode}
        onChangeText={value => setInviteCode(value.toUpperCase())}
        placeholder="ABC123"
        placeholderTextColor="#8A8883"
        autoCapitalize="characters"
        maxLength={6}
      />
      <Button label={busy ? 'Checking' : 'Join drop'} onPress={lookupInvite} disabled={busy} />
    </Screen>
  );
}

function GuestUploadScreen() {
  const {state, run, busy} = useAppState();
  const [guestName, setGuestName] = useState('');
  const [note, setNote] = useState('');
  const [uploadedCount, setUploadedCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const project = state.project;

  async function pickGuestMedia() {
    if (!project) {
      Alert.alert('Invite required', 'Enter a valid invite code before uploading.');
      return;
    }
    const result = await launchImageLibrary({mediaType: 'mixed', selectionLimit: 24, quality: 0.9});
    const picked = result.assets || [];
    if (result.didCancel || !picked.length) {
      return;
    }
    run(
      async () => {
        let count = 0;
        const uploadItems = picked.filter(item => item.uri);
        setUploadProgress({current: 0, total: uploadItems.length, label: 'Preparing upload'});
        try {
          for (const item of uploadItems) {
            if (!item.uri) {
              continue;
            }
            setUploadProgress({current: count, total: uploadItems.length, label: item.fileName ? `Uploading ${item.fileName}` : 'Uploading moment'});
            const upload = await uploadFile({
              uri: item.uri,
              type: item.type,
              fileName: item.fileName,
              projectId: project.id,
            });
            const assetType = upload.suggested_asset_type === 'music' ? 'video' : upload.suggested_asset_type;
            const dimensions = assetDimensionsFromUnknown({width: item.width, height: item.height});
            const response = await registerAsset({
              type: assetType,
              url: upload.url,
              tag: assetType === 'video' ? 'guest video' : 'guest photo',
              description: item.fileName || upload.filename,
              metadata: {
                ...dimensions,
                source: 'guest_upload',
                project_id: project.id,
                guest_name: guestName.trim() || undefined,
                oss_key: upload.oss_key || undefined,
              },
              analysis_status: 'ready',
              analysis: {
                visual: {
                  description: item.fileName || upload.filename,
                  detected_tags: ['guest POV'],
                  mood: 'candid',
                },
              },
            });
            await linkProjectAsset(project.id, {
              asset_id: response.asset.id,
              source: 'guest_upload',
              guest_name: guestName.trim() || undefined,
              note: note.trim() || undefined,
            });
            count += 1;
            setUploadProgress({current: count, total: uploadItems.length, label: 'Saving to drop'});
          }
        } finally {
          setUploadProgress(null);
        }
        return count;
      },
      count => {
        setUploadedCount(current => current + count);
      },
    );
  }

  if (!project) {
    return (
      <Screen>
        <Text style={styles.title}>Invite required</Text>
        <Text style={styles.bodyText}>Go back and enter the couple's drop code.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Drop for {project.couple_names}</Text>
      <Text style={styles.subtle}>Send your camera roll straight to their reel. No edit tools, no paywall.</Text>
      <Field label="Your name" value={guestName} onChangeText={setGuestName} placeholder="Mia" />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Table 8 dance floor clips" />
      <Pressable accessibilityRole="button" style={styles.uploadAudioCard} onPress={pickGuestMedia} disabled={busy}>
        <View>
          <Text style={styles.cardTitle}>{busy ? 'Uploading' : 'Drop photos or videos'}</Text>
          <Text style={styles.bodyText}>Your upload goes only to the couple's project.</Text>
        </View>
        <IconGlyph name="camera" size={40} />
      </Pressable>
      {uploadProgress ? <UploadProgressTray progress={uploadProgress} /> : null}
      {uploadedCount ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Delivered</Text>
          <Text style={styles.bodyText}>{uploadedCount} file{uploadedCount === 1 ? '' : 's'} added to the drop.</Text>
        </View>
      ) : null}
    </Screen>
  );
}

function PhotoWallScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'PhotoWall'>) {
  const {state, setState, run, busy} = useAppState();
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const visualAssets = state.localAssets.filter(asset => asset.type === 'photo' || asset.type === 'video');
  const projectId = state.project?.id;

  useEffect(() => {
    if (!projectId) {
      return;
    }
    listProjectAssets(projectId)
      .then(value => setState(current => mergeAssetsIntoState(current, value.items.map(item => item.asset))))
      .catch(() => undefined);
  }, [setState, projectId]);

  async function pickMedia() {
    const result = await launchImageLibrary({mediaType: 'mixed', selectionLimit: 24, quality: 0.9});
    const picked = result.assets || [];
    if (result.didCancel || !picked.length) {
      return;
    }

    run(
      async () => {
        const registered: Asset[] = [];
        const previews: LocalAsset[] = [];
        const uploadItems = picked.filter(item => item.uri);
        setUploadProgress({current: 0, total: uploadItems.length, label: 'Preparing upload'});
        try {
          for (const item of uploadItems) {
            if (!item.uri) {
              continue;
            }
            setUploadProgress({current: registered.length, total: uploadItems.length, label: item.fileName ? `Uploading ${item.fileName}` : 'Uploading moment'});
            const upload = await uploadFile({
              uri: item.uri,
              type: item.type,
              fileName: item.fileName,
              projectId: state.project?.id,
            });
            const assetType = upload.suggested_asset_type === 'music' ? 'video' : upload.suggested_asset_type;
            const tag = assetType === 'video' ? 'video' : 'wedding';
            const dimensions = assetDimensionsFromUnknown({width: item.width, height: item.height});
            const response = await registerAsset({
              type: assetType,
              url: upload.url,
              tag,
              description: item.fileName || upload.filename,
              metadata: {
                ...dimensions,
                project_id: state.project?.id,
                oss_key: upload.oss_key || undefined,
              },
              analysis_status: 'ready',
              analysis: {
                visual: {
                  description: item.fileName || upload.filename,
                  detected_tags: [tag],
                  mood: 'romantic',
                },
              },
            });
            if (state.project) {
              await linkProjectAsset(state.project.id, {
                asset_id: response.asset.id,
                source: 'owner_upload',
              });
            }
            registered.push(response.asset);
            previews.push(localAssetFromAsset(response.asset, item.uri, dimensions));
            setUploadProgress({current: registered.length, total: uploadItems.length, label: 'Adding to Moments'});
          }
        } finally {
          setUploadProgress(null);
        }
        return {registered, previews};
      },
      value =>
        setState(current => ({
          ...current,
          assets: [...current.assets, ...value.registered],
          localAssets: [...current.localAssets, ...value.previews],
          advisorOptions: [],
          selectedOptionId: null,
          renderStage: 'idle',
          spec: null,
          renderJob: null,
          previewJob: null,
          finalJob: null,
          playbackUrl: null,
          playbackUrlExpiresAt: null,
          previewPlaybackUrl: null,
          previewPlaybackUrlExpiresAt: null,
          finalPlaybackUrl: null,
          finalPlaybackUrlExpiresAt: null,
          unlockStage: 'idle',
        })),
    );
  }

  async function loadDemoMoments() {
    const activeProjectId = state.project?.id;
    run(
      async () => {
        const demoAssets = await fetchDemoAssets();
        const selected = demoAssets.filter(asset => asset.type === 'photo').slice(0, 10);
        const registered = await Promise.all(
          selected.map(asset =>
            registerAsset({
              type: asset.type,
              url: asset.url,
              tag: asset.tag,
              description: asset.description || asset.tag,
              metadata: asset.metadata || {},
              analysis_status: asset.analysis_status || 'ready',
              analysis: asset.analysis || {},
            }).then(response => response.asset),
          ),
        );
        if (activeProjectId) {
          await Promise.all(
            registered.map(asset =>
              linkProjectAsset(activeProjectId, {
                asset_id: asset.id,
                source: 'owner_upload',
              }),
            ),
          );
        }
        return registered;
      },
      registered => {
        setState(current => ({
          ...current,
          assets: [...current.assets, ...registered],
          localAssets: [...current.localAssets, ...registered.map(asset => localAssetFromAsset(asset))],
          advisorOptions: [],
          selectedOptionId: null,
          renderStage: 'idle',
          spec: null,
          renderJob: null,
          previewJob: null,
          finalJob: null,
          playbackUrl: null,
          playbackUrlExpiresAt: null,
          previewPlaybackUrl: null,
          previewPlaybackUrlExpiresAt: null,
          finalPlaybackUrl: null,
          finalPlaybackUrlExpiresAt: null,
          unlockStage: 'idle',
        }));
      },
    );
  }

  function continueToAudio() {
    if (!visualAssets.length) {
      Alert.alert('Add moments', 'Add photos or videos before choosing music.');
      return;
    }
    if (!state.project) {
      navigation.navigate('AudioPicker');
      return;
    }
    run(
      async () => listProjectAssets(state.project!.id),
      value => {
        setState(current => mergeAssetsIntoState(current, value.items.map(item => item.asset)));
        navigation.navigate('AudioPicker');
      },
    );
  }

  const clipCount = visualAssets.length || state.assets.length;
  const clipLabel = clipCount === 1 ? '1 clip' : `${clipCount} clips`;
  const canContinue = visualAssets.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.photoWallScreen}>
        <ScrollView contentContainerStyle={styles.wallContent} showsVerticalScrollIndicator={false}>
          <View style={styles.momentsTopBar}>
            <View>
              <Text style={styles.momentsTitle}>Moments</Text>
              <Text style={styles.momentsMeta}>{clipLabel}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try sample moments"
              style={styles.sampleLink}
              onPress={loadDemoMoments}
              disabled={busy}>
              <Text style={styles.sampleLinkText}>Sample</Text>
            </Pressable>
          </View>

          <MomentsGuide canContinue={canContinue} />

          <PhotoWallGrid
            assets={visualAssets}
            onOpen={asset => navigation.navigate('Tagging', {assetId: asset.id})}
            emptyAction={pickMedia}
          />

        </ScrollView>
        {uploadProgress ? (
          <View style={styles.momentsUploadProgress}>
            <UploadProgressTray progress={uploadProgress} />
          </View>
        ) : null}
        <View style={styles.stickyCta}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photo or video"
            style={[styles.momentsDockButton, styles.momentsDockPrimary]}
            onPress={pickMedia}
            disabled={busy}>
            <IconGlyph name="camera" size={28} tintColor={UI.ink} />
            <Text style={styles.momentsDockPrimaryText}>{busy ? 'Uploading' : 'Camera roll'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next"
            style={[styles.momentsDockButton, styles.momentsDockNext, !canContinue && styles.momentsDockDisabled]}
            onPress={continueToAudio}
            disabled={!canContinue}>
            <Text style={[styles.momentsDockNextText, !canContinue && styles.momentsDockNextTextDisabled]}>Next</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function MomentsGuide({canContinue}: {canContinue: boolean}) {
  const soundTitle = canContinue ? 'Next' : 'Sound';
  const soundTint = canContinue ? UI.ink : UI.muted;
  return (
    <View style={styles.momentsGuide}>
      <View style={styles.momentsGuideItem}>
        <IconGlyph name="camera" size={34} tintColor={UI.ink} />
        <Text style={styles.momentsGuideTitle}>Add clips</Text>
      </View>
      <View style={styles.momentsGuideDivider} />
      <View style={styles.momentsGuideItem}>
        <IconGlyph name="tag" size={34} tintColor={UI.ink} />
        <Text style={styles.momentsGuideTitle}>Tap to tag</Text>
      </View>
      <View style={styles.momentsGuideDivider} />
      <View style={styles.momentsGuideItem}>
        <IconGlyph name="sound" size={34} tintColor={soundTint} />
        <Text style={[styles.momentsGuideTitle, !canContinue && styles.momentsGuideTitleMuted]}>{soundTitle}</Text>
      </View>
    </View>
  );
}

function TaggingScreen({navigation, route}: NativeStackScreenProps<CreateStackParams, 'Tagging'>) {
  const {state, setState, run, busy} = useAppState();
  const asset = state.localAssets.find(item => item.id === route.params.assetId);
  const [customTag, setCustomTag] = useState('');

  if (!asset) {
    return (
      <Screen>
        <Text style={styles.title}>Moment not found</Text>
        <Button label="Back" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }
  const assetId = asset.id;
  const selectedTags = new Set(uniqueTags([asset.tag, ...asset.tags]));
  const tagOptions = uniqueTags([...RECOMMENDED_TAGS, asset.tag, ...asset.tags]).slice(0, 12);

  function applyTag(tag: string) {
    const nextTag = normalizeTagValue(tag);
    if (!nextTag) {
      return;
    }
    setState(current => applyTagToState(current, assetId, nextTag));
    const apiPayload = assetUpdatePayloadForTag(state.assets.find(item => item.id === assetId), nextTag);
    updateAsset(assetId, apiPayload)
      .then(response => setState(current => mergeAssetsIntoState(current, [response.asset])))
      .catch(error => Alert.alert('Tag not saved', error.message));
  }

  function deleteMoment() {
    Alert.alert(
      'Delete this moment?',
      'This removes it from this reel. It will not delete photos from your camera roll.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const projectId = state.project?.id;
            if (!projectId) {
              setState(current => removeAssetFromState(current, assetId));
              navigation.goBack();
              return;
            }
            run(
              async () => unlinkProjectAsset(projectId, assetId),
              () => {
                setState(current => removeAssetFromState(current, assetId));
                navigation.goBack();
              },
            );
          },
        },
      ],
    );
  }

  return (
    <Screen>
      <View style={styles.detailPreview}>
        <MomentVisual asset={asset} />
        <View style={styles.photoNoteLarge}>
          <Text style={styles.photoNoteText}>{asset.tag}</Text>
        </View>
      </View>
      <Text style={styles.titleSmall}>Tag this moment</Text>
      <Text style={styles.subtle}>Use suggested tags or add one that matches the story.</Text>
      <View style={styles.tagCloud}>
        {tagOptions.map(tag => (
          <TagChip key={tag} label={tag} selected={selectedTags.has(tag)} onPress={() => applyTag(tag)} />
        ))}
      </View>
      <View style={styles.customTagRow}>
        <TextInput
          style={styles.tagInput}
          value={customTag}
          onChangeText={setCustomTag}
          placeholder="Custom tag"
          placeholderTextColor="#8A8883"
        />
        <Pressable
          style={styles.smallButton}
          onPress={() => {
            if (customTag.trim()) {
              applyTag(customTag.trim());
              setCustomTag('');
            }
          }}>
          <Text style={styles.smallButtonText}>Add</Text>
        </Pressable>
      </View>
      <Button label="Done" onPress={() => navigation.goBack()} />
      <Pressable accessibilityRole="button" style={styles.deleteMomentRow} onPress={deleteMoment} disabled={busy}>
        <Text style={styles.deleteMomentText}>{busy ? 'Deleting' : 'Delete moment'}</Text>
      </Pressable>
    </Screen>
  );
}

function AudioPickerScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'AudioPicker'>) {
  const {state, setState, run, busy} = useAppState();
  const [demoMusic, setDemoMusic] = useState<DemoAsset[]>([]);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [playingTitle, setPlayingTitle] = useState<string | null>(null);

  useEffect(() => {
    fetchDemoAssets()
      .then(assets => setDemoMusic(assets.filter(asset => asset.type === 'music')))
      .catch(error => Alert.alert('Music unavailable', error.message));
  }, []);

  function togglePreview(track: {url: string; title: string}) {
    const previewUrl = normalizeLocalExportUrl(track.url) || track.url;
    if (playingUrl === previewUrl) {
      setPlayingUrl(null);
      setPlayingTitle(null);
      return;
    }
    setPlayingUrl(previewUrl);
    setPlayingTitle(track.title);
  }

  async function selectBuiltIn(track: DemoAsset) {
    run(
      async () => {
        const existing = state.assets.find(asset => asset.type === 'music' && asset.url.endsWith(track.url));
        if (existing) {
          return existing;
        }
        const response = await registerAsset({
          type: 'music',
          url: track.url,
          tag: track.tag,
          description: track.description || track.tag,
          analysis_status: track.analysis_status || 'ready',
          analysis: track.analysis || {},
        });
        return response.asset;
      },
      asset =>
        setState(current => ({
          ...current,
          assets: [...current.assets.filter(item => item.id !== asset.id), asset],
          selectedMusicAssetId: asset.id,
        })),
    );
  }

  function selectUploaded(asset: Asset) {
    setState(current => ({...current, selectedMusicAssetId: asset.id}));
  }

  async function uploadAudio() {
    try {
      const [file] = await pick({type: [documentTypes.audio]});
      if (!file?.uri) {
        return;
      }
      run(
        async () => {
            const upload = await uploadFile({
              uri: file.uri,
              type: file.type || 'audio/mpeg',
              fileName: file.name || 'music.mp3',
              projectId: state.project?.id,
            });
          if (upload.suggested_asset_type !== 'music') {
            throw new Error('Choose an audio file like MP3, M4A, WAV, AAC, or OGG.');
          }
          const response = await registerAsset({
            type: 'music',
            url: upload.url,
            tag: 'uploaded',
            description: file.name || upload.filename,
            metadata: {
              source: 'user_upload',
              filename: upload.filename,
              content_type: upload.content_type,
              size_bytes: upload.size_bytes,
              project_id: state.project?.id,
              oss_key: upload.oss_key || undefined,
            },
            analysis_status: 'ready',
            analysis: {
              audio: {
                description: file.name || upload.filename,
                beat_sync_recommended: state.beatSyncEnabled,
              },
            },
          });
          return response.asset;
        },
        asset =>
          setState(current => ({
            ...current,
            assets: [asset, ...current.assets.filter(item => item.id !== asset.id && item.url !== asset.url)],
            selectedMusicAssetId: asset.id,
          })),
      );
    } catch (error) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      Alert.alert('Audio failed', error instanceof Error ? error.message : 'Unable to pick audio.');
    }
  }

  function continueToInterview() {
    setPlayingUrl(null);
    setPlayingTitle(null);
    navigation.navigate('Interview');
  }

  const selectedMusic = state.assets.find(asset => asset.id === state.selectedMusicAssetId);
  const uploadedMusic = useMemo(
    () => state.assets.filter(asset => asset.type === 'music' && asset.metadata?.source === 'user_upload'),
    [state.assets],
  );
  const statusLabel = playingUrl ? 'Playing' : selectedMusic ? 'Selected' : 'Track';
  const statusTitle = playingTitle || cleanMusicText(selectedMusic?.description || selectedMusic?.tag) || 'Pick a track';
  const trackCountLabel = demoMusic.length === 1 ? '1 track' : `${demoMusic.length} tracks`;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.photoWallScreen}>
        <ScrollView contentContainerStyle={styles.soundContent} showsVerticalScrollIndicator={false}>
          <View style={styles.momentsTopBar}>
            <View>
              <Text style={styles.momentsTitle}>Sound</Text>
              <Text style={styles.momentsMeta}>{selectedMusic ? 'Selected' : trackCountLabel}</Text>
            </View>
          </View>

          <View style={styles.soundStatusRow}>
            <View style={styles.soundStatusIcon}>
              <IconGlyph name="sound" size={24} tintColor="#FFFFFF" />
            </View>
            <View style={styles.soundStatusText}>
              <Text style={styles.soundStatusLabel}>{statusLabel}</Text>
              <Text style={styles.soundStatusTitle} numberOfLines={1}>{statusTitle}</Text>
            </View>
          </View>

          <Text style={styles.soundHint}>Preview, then choose one track.</Text>

          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Beat sync"
            accessibilityState={{checked: state.beatSyncEnabled}}
            style={styles.soundSettingRow}
            onPress={() => setState(current => ({...current, beatSyncEnabled: !current.beatSyncEnabled}))}>
            <View style={styles.soundRowText}>
              <Text style={styles.soundRowTitle}>Beat sync</Text>
              <Text style={styles.soundRowMeta}>{state.beatSyncEnabled ? 'On' : 'Off'}</Text>
            </View>
            <View style={[styles.switch, state.beatSyncEnabled && styles.switchOn]}>
              <View style={[styles.switchKnob, state.beatSyncEnabled && styles.switchKnobOn]} />
            </View>
          </Pressable>

          <View style={styles.soundTrackList}>
            {uploadedMusic.map(asset => {
              const title = uploadedMusicTitle(asset);
              const previewUrl = normalizeLocalExportUrl(asset.url) || asset.url;
              const isPlaying = playingUrl === previewUrl;
              return (
                <SoundTrackRow
                  key={asset.id}
                  title={title}
                  subtitle={uploadedMusicMeta(asset)}
                  selected={selectedMusic?.id === asset.id}
                  isPlaying={isPlaying}
                  onPreview={() => togglePreview({url: asset.url, title})}
                  onPress={() => selectUploaded(asset)}
                />
              );
            })}
            {demoMusic.map(track => {
              const selected = Boolean(selectedMusic && selectedMusic.url.endsWith(track.url));
              const title = track.title || track.tag;
              const previewUrl = normalizeLocalExportUrl(track.url) || track.url;
              const isPlaying = playingUrl === previewUrl;
              return (
                <SoundTrackRow
                  key={track.id}
                  title={title}
                  subtitle={formatTrackMeta(track)}
                  selected={selected}
                  isPlaying={isPlaying}
                  onPreview={() => togglePreview({url: track.url, title})}
                  onPress={() => selectBuiltIn(track)}
                />
              );
            })}
          </View>
        </ScrollView>

        <View style={styles.stickyCta}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Upload your own audio"
            style={[styles.momentsDockButton, styles.momentsDockPrimary]}
            onPress={uploadAudio}
            disabled={busy}>
            <Text style={styles.soundDockPlus}>+</Text>
            <Text style={styles.momentsDockPrimaryText}>{busy ? 'Uploading' : 'Upload'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next"
            style={[styles.momentsDockButton, styles.momentsDockNext]}
            onPress={continueToInterview}
            disabled={busy}>
            <Text style={styles.momentsDockNextText}>Next</Text>
          </Pressable>
        </View>

        {playingUrl ? (
          <Video
            source={{uri: playingUrl}}
            style={styles.audioPlayer}
            paused={false}
            playInBackground={false}
            ignoreSilentSwitch="ignore"
            onEnd={() => {
              setPlayingUrl(null);
              setPlayingTitle(null);
            }}
            onError={() => {
              setPlayingUrl(null);
              setPlayingTitle(null);
              Alert.alert('Preview failed', 'Unable to play this audio in the app.');
            }}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function cleanMusicText(value?: string) {
  if (!value) {
    return '';
  }
  return value
    .split(',')
    .map(part => part.trim().replace(/_/g, ' '))
    .filter(Boolean)
    .slice(0, 2)
    .join(' / ');
}

function uploadedMusicTitle(asset: Asset) {
  const filename = typeof asset.metadata?.filename === 'string' ? asset.metadata.filename : undefined;
  const raw = filename || asset.description || asset.tag;
  return raw
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim() || 'Uploaded track';
}

function uploadedMusicMeta(asset: Asset) {
  const sizeBytes = typeof asset.metadata?.size_bytes === 'number' ? asset.metadata.size_bytes : undefined;
  if (!sizeBytes) {
    return 'Your upload';
  }
  const sizeMb = sizeBytes / (1024 * 1024);
  return `Your upload / ${sizeMb >= 10 ? sizeMb.toFixed(0) : sizeMb.toFixed(1)} MB`;
}

function formatTrackMeta(track: DemoAsset) {
  if (track.tags?.length) {
    return track.tags
      .slice(0, 2)
      .map(tag => tag.replace(/_/g, ' '))
      .join(' / ');
  }
  return cleanMusicText(track.description || track.tag) || 'Reel track';
}

async function startRenderJob(job: RenderJob) {
  return (await startConfiguredRender(job.id)).job;
}

function InterviewScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'Interview'>) {
  const {state, setState} = useAppState();
  const [stepIndex, setStepIndex] = useState(Math.min(state.interviewAnswers.length, INTERVIEW_STEPS.length - 1));
  const currentStep = INTERVIEW_STEPS[stepIndex];
  const projectCoupleNames = state.details.coupleNames || state.project?.couple_names || '';
  const answerForStep = useCallback((stepId: string) => {
    const saved = state.interviewAnswers.find(item => item.questionId === stepId)?.answer;
    if (saved) {
      return saved;
    }
    return stepId === 'couple' ? projectCoupleNames : '';
  }, [projectCoupleNames, state.interviewAnswers]);
  const existingAnswer = answerForStep(currentStep.id);
  const [answer, setAnswer] = useState(existingAnswer);

  useEffect(() => {
    const nextStep = INTERVIEW_STEPS[stepIndex];
    setAnswer(answerForStep(nextStep.id));
  }, [answerForStep, stepIndex]);

  function saveAnswer(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      Alert.alert('Direction needed', 'Add a short note so the reel has a clear point of view.');
      return;
    }
    setState(current => {
      const nextAnswers = [
        ...current.interviewAnswers.filter(item => item.questionId !== currentStep.id),
        {questionId: currentStep.id, question: currentStep.question, answer: trimmed},
      ];
      const details = detailsFromAnswers(nextAnswers);
      return {...current, interviewAnswers: nextAnswers, details};
    });
    if (stepIndex === INTERVIEW_STEPS.length - 1) {
      navigation.navigate('RenderingResult');
      return;
    }
    setStepIndex(index => index + 1);
  }

  return (
    <Screen>
      <View style={styles.interviewHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>v</Text>
        </View>
        <View style={styles.interviewIntro}>
          <Text style={styles.cardTitle}>Reel direction</Text>
          <Text style={styles.bodyText}>Prompt {stepIndex + 1} of {INTERVIEW_STEPS.length}</Text>
        </View>
      </View>

      <View style={styles.progressDots}>
        {INTERVIEW_STEPS.map((step, index) => (
          <View key={step.id} style={[styles.progressDot, index <= stepIndex && styles.progressDotActive]} />
        ))}
      </View>

      <View style={styles.questionBubble}>
        <Text style={styles.questionText}>{currentStep.question}</Text>
      </View>
      <View style={styles.answerBubble}>
        <TextInput
          style={styles.answerInput}
          value={answer}
          onChangeText={setAnswer}
          placeholder={currentStep.placeholder}
          placeholderTextColor="#8A8883"
          multiline
        />
      </View>
      <View style={styles.quickReplies}>
        {currentStep.suggestions.map(reply => (
          <Pressable key={reply} style={styles.quickReply} onPress={() => setAnswer(reply)}>
            <Text style={styles.quickReplyText}>{reply}</Text>
          </Pressable>
        ))}
      </View>
      <Button label={stepIndex === INTERVIEW_STEPS.length - 1 ? 'Cut preview' : 'Next prompt'} onPress={() => saveAnswer(answer)} />
    </Screen>
  );
}

function RenderingResultScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'RenderingResult'>) {
  const {state, setState} = useAppState();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const outputUrl = state.previewPlaybackUrl || state.playbackUrl || undefined;
  const isReady = state.renderStage === 'ready' && Boolean(outputUrl);

  useEffect(() => {
    if (startedRef.current || state.renderStage === 'ready') {
      return;
    }
    cancelledRef.current = false;
    startedRef.current = true;
    createVideo();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchRenderState(job: RenderJob) {
    if (cancelledRef.current) {
      return;
    }
    setState(current => ({
      ...current,
      renderJob: job,
      renderStage: renderStageFromJob(job.status),
    }));
  }

  async function waitForReadyJob(job: RenderJob) {
    let latestJob = job;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (cancelledRef.current) {
        throw new Error('Render was cancelled.');
      }
      patchRenderState(latestJob);
      if (latestJob.status === 'ready') {
        return latestJob;
      }
      if (isTerminalRenderFailure(latestJob.status)) {
        throw new Error(latestJob.error || `Render job ${latestJob.status}.`);
      }
      await delay(3000);
      latestJob = (await getRenderJob(latestJob.id)).job;
    }
    throw new Error('Render timed out.');
  }

  async function createVideo() {
    try {
      setError(null);
      setState(current => ({
        ...current,
        renderStage: 'story',
        renderJob: null,
        previewJob: null,
        finalJob: null,
        playbackUrl: null,
        playbackUrlExpiresAt: null,
        previewPlaybackUrl: null,
        previewPlaybackUrlExpiresAt: null,
        finalPlaybackUrl: null,
        finalPlaybackUrlExpiresAt: null,
        unlockStage: 'idle',
      }));
      const options = await createAdvisorOptions({
        couple_names: state.details.coupleNames || 'Our Wedding',
        wedding_date: state.details.weddingDate,
        location: state.details.location,
        asset_ids: state.assets.map(asset => asset.id),
      });
      const option = options.options[0];
      if (!option) {
        throw new Error('No edit direction returned.');
      }
      setState(current => ({
        ...current,
        advisorOptions: options.options,
        selectedOptionId: option.id,
        renderStage: 'beats',
      }));

      const generated = await generateVideoSpec({
        template_id: option.template_id,
        title: `${state.details.coupleNames || 'Our Wedding'} Reel`,
        asset_ids: state.assets.map(asset => asset.id),
        aspect_ratio: option.aspect_ratio,
        style_preset_id: stylePresetFromAnswers(state.interviewAnswers).id,
      });

      setState(current => ({...current, renderStage: 'rendering'}));
      const updatedSpec = patchSpecForInterview(generated.spec, option, state);
      const saved = await saveVideoSpec(updatedSpec);
      const project = state.project
        ? await updateVideoProject(state.project.id, {
            spec_id: saved.spec.id,
            couple_names: state.details.coupleNames || state.project.couple_names,
            wedding_date: state.details.weddingDate || undefined,
            location: state.details.location || undefined,
          })
        : await createVideoProject({
            spec_id: saved.spec.id,
            couple_names: state.details.coupleNames || 'Our Wedding',
            wedding_date: state.details.weddingDate || undefined,
            location: state.details.location || undefined,
          });
      const manifestJob = await createProjectPreviewRender(project.project.id);
      setState(current => ({
        ...current,
        spec: saved.spec,
        project: project.project,
        renderJob: manifestJob.job,
        previewJob: manifestJob.job,
        renderStage: 'provisioning',
      }));
      const startedJob = await startRenderJob(manifestJob.job);
      const readyJob = startedJob.status === 'ready' ? startedJob : await waitForReadyJob(startedJob);
      const playback = await getProjectPreviewPlayback(project.project.id);
      if (!playback.url) {
        throw new Error('Render completed without an output URL.');
      }
      setState(current => ({
        ...current,
        spec: saved.spec,
        project: project.project,
        renderJob: readyJob,
        previewJob: readyJob,
        playbackUrl: playback.url,
        playbackUrlExpiresAt: playback.expires_at,
        previewPlaybackUrl: playback.url,
        previewPlaybackUrlExpiresAt: playback.expires_at,
        renderStage: 'ready',
      }));
    } catch (caught) {
      if (cancelledRef.current) {
        return;
      }
      const message = caught instanceof Error ? caught.message : 'Unable to render video.';
      setError(message);
      setState(current => ({...current, renderStage: 'failed'}));
    }
  }

  function retry() {
    startedRef.current = false;
    cancelledRef.current = false;
    createVideo();
  }

  return (
    <SafeAreaView style={styles.resultSafe}>
      <ScrollView contentContainerStyle={styles.resultContent}>
        <View style={styles.topBar}>
          <Text style={styles.resultWordmark}>VowFrame</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New reel"
            style={styles.tinyPill}
            onPress={() => navigation.popToTop()}>
            <Text style={styles.tinyPillText}>New reel</Text>
          </Pressable>
        </View>

        {!isReady ? (
          <View style={styles.renderPanel}>
            <Text style={styles.resultTitle}>Rendering</Text>
            <Text style={styles.resultSubtle}>Turning your moments into a vertical reel.</Text>
            <StageRow label="Building the story" active={state.renderStage === 'story'} done={isStageDone(state.renderStage, 'story')} />
            <StageRow label="Matching beats" active={state.renderStage === 'beats'} done={isStageDone(state.renderStage, 'beats')} />
            <StageRow label="Starting render" active={state.renderStage === 'provisioning'} done={isStageDone(state.renderStage, 'provisioning')} />
            <StageRow label="Cutting MP4" active={state.renderStage === 'rendering'} done={isStageDone(state.renderStage, 'rendering')} />
            <StageRow label="Saving preview" active={state.renderStage === 'uploading'} done={state.renderStage === 'ready'} />
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Button label="Try again" variant="secondary" onPress={retry} />
              </View>
            ) : null}
          </View>
        ) : (
          <ResultCard navigation={navigation} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ResultCard({navigation}: {navigation: NativeStackScreenProps<CreateStackParams, 'RenderingResult'>['navigation']}) {
  const {state, setState} = useAppState();
  const [exportAction, setExportAction] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [modifyVisible, setModifyVisible] = useState(false);
  const [modifyPrompt, setModifyPrompt] = useState('');
  const [pendingPaidAction, setPendingPaidAction] = useState<'save' | 'share' | 'modify' | null>(null);
  const [selectedIapProductId, setSelectedIapProductId] = useState<IapProductId>('com.aigcteacher.vowframeapp.singleexport');
  const storeProducts = useStoreProducts(paywallVisible);
  const outputUrl = state.previewPlaybackUrl || state.playbackUrl || undefined;
  const entitlementActive = state.project?.entitlement_status === 'active';
  const currentStyle = stylePresetFromAnswers(state.interviewAnswers);

  useEffect(() => {
    if (state.previewJob?.status !== 'ready' || !isPlaybackUrlExpired(state.previewPlaybackUrlExpiresAt)) {
      return;
    }
    if (state.project) {
      getProjectPreviewPlayback(state.project.id)
        .then(playback =>
          setState(current => ({
            ...current,
            playbackUrl: playback.url,
            playbackUrlExpiresAt: playback.expires_at,
            previewPlaybackUrl: playback.url,
            previewPlaybackUrlExpiresAt: playback.expires_at,
          })),
        )
        .catch(() => undefined);
      return;
    }
    getRenderJobPlayback(state.previewJob.id)
      .then(playback =>
        setState(current => ({
          ...current,
          playbackUrl: playback.url,
          playbackUrlExpiresAt: playback.expires_at,
          previewPlaybackUrl: playback.url,
          previewPlaybackUrlExpiresAt: playback.expires_at,
        })),
      )
      .catch(() => undefined);
  }, [
    setState,
    state.previewJob?.id,
    state.previewJob?.status,
    state.previewPlaybackUrlExpiresAt,
    state.project,
  ]);

  function tryAnotherCut() {
    const currentIndex = STYLE_PRESET_CHOICES.findIndex(choice => choice.id === currentStyle.id);
    const nextStyle = STYLE_PRESET_CHOICES[(currentIndex + 1) % STYLE_PRESET_CHOICES.length];
    setPreviewError(null);
    setState(current => ({
      ...current,
      interviewAnswers: upsertInterviewAnswer(current.interviewAnswers, 'style', 'Choose the cut style.', nextStyle.label),
      advisorOptions: [],
      selectedOptionId: null,
      renderStage: 'idle',
      spec: null,
      renderJob: null,
      previewJob: null,
      finalJob: null,
      playbackUrl: null,
      playbackUrlExpiresAt: null,
      previewPlaybackUrl: null,
      previewPlaybackUrlExpiresAt: null,
      finalPlaybackUrl: null,
      finalPlaybackUrlExpiresAt: null,
      unlockStage: 'idle',
    }));
    navigation.replace('RenderingResult');
  }

  async function withPreviewExportUrl(action: string, task: (exportUrl: string) => Promise<void>) {
    let exportUrl = outputUrl;
    if (!exportUrl && state.previewJob?.status === 'ready') {
      const playback = state.project
        ? await getProjectPreviewPlayback(state.project.id)
        : await getRenderJobPlayback(state.previewJob.id);
      exportUrl = playback.url;
      setState(current => ({
        ...current,
        playbackUrl: playback.url,
        playbackUrlExpiresAt: playback.expires_at,
        previewPlaybackUrl: playback.url,
        previewPlaybackUrlExpiresAt: playback.expires_at,
      }));
    }
    if (!exportUrl) {
      Alert.alert('Preview unavailable', 'The watermarked preview is not ready yet.');
      return;
    }
    try {
      setExportAction(action);
      await task(exportUrl);
    } catch (caught) {
      Alert.alert('Export failed', caught instanceof Error ? caught.message : 'Unable to complete export action.');
    } finally {
      setExportAction(null);
    }
  }

  async function performFinalAction(action: 'save' | 'share', exportUrl: string) {
    setExportAction(action);
    try {
      if (action === 'save') {
        if (!VowFrameExportModule) {
          throw new Error('The native export module is not available in this build.');
        }
        await VowFrameExportModule.saveVideoToPhotos(exportUrl);
        Alert.alert('Saved to Photos', 'Your clean wedding reel was saved.');
        return;
      }
      if (VowFrameExportModule) {
        const localExport = await VowFrameExportModule.downloadExport(exportUrl);
        await Share.share({title: 'VowFrame wedding reel', message: 'My VowFrame wedding reel is ready.', url: localExport.fileUri});
        return;
      }
      await Share.share({title: 'VowFrame wedding reel', message: exportUrl});
    } catch (caught) {
      Alert.alert('Export failed', caught instanceof Error ? caught.message : 'Unable to complete export action.');
    } finally {
      setExportAction(null);
    }
  }

  async function waitForPaidJob(job: RenderJob) {
    let latestJob = job;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      setState(current => ({
        ...current,
        finalJob: latestJob,
        unlockStage: unlockStageFromJob(latestJob.status),
      }));
      if (latestJob.status === 'ready') {
        return latestJob;
      }
      if (isTerminalRenderFailure(latestJob.status)) {
        throw new Error(latestJob.error || `Final render ${latestJob.status}.`);
      }
      await delay(3000);
      latestJob = (await getRenderJob(latestJob.id)).job;
    }
    throw new Error('Final render timed out.');
  }

  async function waitForModifiedPreviewJob(job: RenderJob) {
    let latestJob = job;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      setState(current => ({
        ...current,
        renderJob: latestJob,
        previewJob: latestJob,
        renderStage: renderStageFromJob(latestJob.status),
      }));
      if (latestJob.status === 'ready') {
        return latestJob;
      }
      if (isTerminalRenderFailure(latestJob.status)) {
        throw new Error(latestJob.error || `Preview render ${latestJob.status}.`);
      }
      await delay(3000);
      latestJob = (await getRenderJob(latestJob.id)).job;
    }
    throw new Error('Preview render timed out.');
  }

  async function ensureFinalPlaybackUrl() {
    if (!state.project) {
      throw new Error('Project is missing. Create a preview before unlocking the clean reel.');
    }
    if (state.finalJob?.status === 'ready' && state.finalPlaybackUrl && !isPlaybackUrlExpired(state.finalPlaybackUrlExpiresAt)) {
      return state.finalPlaybackUrl;
    }
    if (state.finalJob?.status === 'ready') {
      const playback = await getProjectFinalPlayback(state.project.id);
      setState(current => ({
        ...current,
        finalPlaybackUrl: playback.url,
        finalPlaybackUrlExpiresAt: playback.expires_at,
      }));
      return playback.url;
    }
    throw new Error('Final reel is not ready yet.');
  }

  async function unlockAndRenderFinal(action: 'save' | 'share', productId: IapProductId = selectedIapProductId) {
    if (!state.project) {
      Alert.alert('Project unavailable', 'Create the preview again before unlocking.');
      return;
    }
    try {
      setExportAction(action);
      setState(current => ({...current, unlockStage: 'purchasing'}));
      const purchase = await purchaseIapProduct(productId);
      const entitlement = await verifyApplePurchase({
        project_id: state.project.id,
        product_id: purchase.product_id,
        transaction_id: purchase.transaction_id,
        original_transaction_id: purchase.original_transaction_id,
      });
      setState(current => ({...current, project: entitlement.project, unlockStage: 'provisioning'}));
      const finalRender = await createProjectFinalRender(entitlement.project.id);
      setState(current => ({...current, project: finalRender.project, finalJob: finalRender.job}));
      const startedJob = await startRenderJob(finalRender.job);
      const readyJob = startedJob.status === 'ready' ? startedJob : await waitForPaidJob(startedJob);
      const playback = await getProjectFinalPlayback(entitlement.project.id);
      setState(current => ({
        ...current,
        project: finalRender.project,
        finalJob: readyJob,
        finalPlaybackUrl: playback.url,
        finalPlaybackUrlExpiresAt: playback.expires_at,
        unlockStage: 'ready',
      }));
      setPaywallVisible(false);
      setPendingPaidAction(null);
      await performFinalAction(action, playback.url);
    } catch (caught) {
      setState(current => ({...current, unlockStage: 'failed'}));
      Alert.alert('Unlock failed', caught instanceof Error ? caught.message : 'Unable to unlock export.');
    } finally {
      setExportAction(null);
    }
  }

  async function unlockForModify(productId: IapProductId = selectedIapProductId) {
    if (!state.project) {
      Alert.alert('Project unavailable', 'Create the preview again before modifying.');
      return;
    }
    try {
      setExportAction('modify');
      setState(current => ({...current, unlockStage: 'purchasing'}));
      const purchase = await purchaseIapProduct(productId);
      const entitlement = await verifyApplePurchase({
        project_id: state.project.id,
        product_id: purchase.product_id,
        transaction_id: purchase.transaction_id,
        original_transaction_id: purchase.original_transaction_id,
      });
      setState(current => ({...current, project: entitlement.project, unlockStage: 'ready'}));
      setPaywallVisible(false);
      setPendingPaidAction(null);
      setModifyVisible(true);
    } catch (caught) {
      setState(current => ({...current, unlockStage: 'failed'}));
      Alert.alert('Unlock failed', caught instanceof Error ? caught.message : 'Unable to unlock modify.');
    } finally {
      setExportAction(null);
    }
  }

  async function startPaidAction(action: 'save' | 'share') {
    if (entitlementActive) {
      try {
        const url = await ensureFinalPlaybackUrl();
        await performFinalAction(action, url);
        return;
      } catch {
        await unlockAndRenderFinal(action);
        return;
      }
    }
    setPendingPaidAction(action);
    setPaywallVisible(true);
  }

  function startModifyAction() {
    if (entitlementActive) {
      setModifyVisible(true);
      return;
    }
    setPendingPaidAction('modify');
    setPaywallVisible(true);
  }

  async function submitModify() {
    const prompt = modifyPrompt.trim();
    if (prompt.length < 3) {
      Alert.alert('Add a direction', 'Describe what you want changed in a short sentence.');
      return;
    }
    if (!state.project) {
      Alert.alert('Project unavailable', 'Create the preview again before modifying.');
      return;
    }
    try {
      setExportAction('modify');
      setPreviewError(null);
      setState(current => ({
        ...current,
        renderStage: 'story',
        renderJob: null,
        previewJob: null,
        finalJob: null,
        playbackUrl: null,
        playbackUrlExpiresAt: null,
        previewPlaybackUrl: null,
        previewPlaybackUrlExpiresAt: null,
        finalPlaybackUrl: null,
        finalPlaybackUrlExpiresAt: null,
      }));
      const modified = await modifyVideoProject(state.project.id, prompt);
      setModifyVisible(false);
      setModifyPrompt('');
      setState(current => ({
        ...current,
        spec: modified.spec,
        project: modified.project,
        renderJob: modified.job,
        previewJob: modified.job,
        renderStage: 'provisioning',
      }));
      const startedJob = await startRenderJob(modified.job);
      const readyJob = startedJob.status === 'ready' ? startedJob : await waitForModifiedPreviewJob(startedJob);
      const playback = await getProjectPreviewPlayback(modified.project.id);
      setState(current => ({
        ...current,
        project: modified.project,
        renderJob: readyJob,
        previewJob: readyJob,
        playbackUrl: playback.url,
        playbackUrlExpiresAt: playback.expires_at,
        previewPlaybackUrl: playback.url,
        previewPlaybackUrlExpiresAt: playback.expires_at,
        renderStage: 'ready',
      }));
    } catch (caught) {
      setState(current => ({...current, renderStage: 'failed'}));
      Alert.alert('Modify failed', caught instanceof Error ? caught.message : 'Unable to modify this reel.');
    } finally {
      setExportAction(null);
    }
  }

  function savePreviewToPhotos() {
    withPreviewExportUrl('save-preview', async exportUrl => {
      if (!VowFrameExportModule) {
        throw new Error('The native export module is not available in this build.');
      }
      await VowFrameExportModule.saveVideoToPhotos(exportUrl);
      Alert.alert('Saved preview', 'The watermarked preview was saved to your photo library.');
    });
  }

  return (
    <>
      <View style={styles.resultPanel}>
        <View style={styles.previewReadyHeader}>
          <View>
            <Text style={styles.previewReadyTitle}>Preview</Text>
            <Text style={styles.previewReadyMeta}>{currentStyle.label} cut · Watermarked</Text>
          </View>
          <View style={styles.previewReadyPill}>
            <Text style={styles.previewReadyPillText}>Ready</Text>
          </View>
        </View>
        <VideoPreviewCard
          outputUrl={outputUrl}
          title={state.spec?.title || 'Wedding reel'}
          meta="Preview"
          size="large"
          onError={() => setPreviewError('Preview failed. The MP4 URL is still available below.')}
        />
        {previewError ? <Text style={styles.previewErrorText}>{previewError}</Text> : null}
        <View style={styles.previewActionDock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save watermarked preview"
            style={[styles.previewDockButton, styles.previewDockSecondary, Boolean(exportAction) && styles.buttonDisabled]}
            onPress={savePreviewToPhotos}
            disabled={Boolean(exportAction)}>
            <Text style={styles.previewDockSecondaryText}>{exportAction === 'save-preview' ? 'Saving' : 'Save preview'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Modify reel"
            style={[styles.previewDockButton, styles.previewDockPrimary, Boolean(exportAction) && styles.buttonDisabled]}
            onPress={startModifyAction}
            disabled={Boolean(exportAction)}>
            <Text style={styles.previewDockPrimaryText}>{exportAction === 'modify' ? 'Cutting' : 'Modify'}</Text>
          </Pressable>
        </View>
        <View style={styles.previewLinkRow}>
          <Pressable accessibilityRole="button" onPress={() => startPaidAction('share')} disabled={Boolean(exportAction)}>
            <Text style={[styles.previewLinkText, Boolean(exportAction) && styles.previewLinkTextDisabled]}>
              {exportAction === 'share' ? 'Preparing' : 'Share clean'}
            </Text>
          </Pressable>
          <View style={styles.previewLinkDivider} />
          <Pressable accessibilityRole="button" onPress={tryAnotherCut} disabled={Boolean(exportAction)}>
            <Text style={[styles.previewLinkText, Boolean(exportAction) && styles.previewLinkTextDisabled]}>Try another cut</Text>
          </Pressable>
        </View>
      </View>
      <PaywallModal
        visible={paywallVisible}
        action={pendingPaidAction}
        unlockStage={state.unlockStage}
        selectedProductId={selectedIapProductId}
        storeProducts={storeProducts}
        onSelectProduct={setSelectedIapProductId}
        onClose={() => setPaywallVisible(false)}
        onUnlock={productId => {
          if (pendingPaidAction === 'modify') {
            unlockForModify(productId);
            return;
          }
          unlockAndRenderFinal(pendingPaidAction || 'save', productId);
        }}
      />
      <ModifyModal
        visible={modifyVisible}
        prompt={modifyPrompt}
        busy={exportAction === 'modify'}
        onChangePrompt={setModifyPrompt}
        onClose={() => setModifyVisible(false)}
        onSubmit={submitModify}
      />
    </>
  );
}

function ModifyModal({
  visible,
  prompt,
  busy,
  onChangePrompt,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  prompt: string;
  busy: boolean;
  onChangePrompt: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.paywallBackdrop}>
        <View style={styles.modifyCard}>
          <Text style={styles.paywallKicker}>Modify</Text>
          <Text style={styles.modifyTitle}>Tell VowFrame what to change.</Text>
          <TextInput
            style={styles.modifyInput}
            value={prompt}
            onChangeText={onChangePrompt}
            placeholder="Make it faster, use more dance clips, less text."
            placeholderTextColor="#8A8883"
            multiline
            editable={!busy}
          />
          <View style={styles.modifyQuickRow}>
            {['More cinematic', 'Faster party cut', 'Less text'].map(reply => (
              <Pressable key={reply} accessibilityRole="button" style={styles.modifyChip} onPress={() => onChangePrompt(reply)} disabled={busy}>
                <Text style={styles.modifyChipText}>{reply}</Text>
              </Pressable>
            ))}
          </View>
          {busy ? (
            <View style={styles.paywallProgress}>
              <ActivityIndicator color={UI.rose} />
              <Text style={styles.paywallProgressText}>Cutting a new preview</Text>
            </View>
          ) : null}
          <Button label={busy ? 'Cutting' : 'Generate new cut'} onPress={onSubmit} disabled={busy} />
          <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

function PaywallModal({
  visible,
  action,
  unlockStage,
  selectedProductId,
  storeProducts,
  onSelectProduct,
  onClose,
  onUnlock,
}: {
  visible: boolean;
  action: 'save' | 'share' | 'modify' | null;
  unlockStage: UnlockStage;
  selectedProductId: IapProductId;
  storeProducts: StoreProduct[];
  onSelectProduct: (productId: IapProductId) => void;
  onClose: () => void;
  onUnlock: (productId: IapProductId) => void;
}) {
  const busy = unlockStage !== 'idle' && unlockStage !== 'ready' && unlockStage !== 'failed';
  const selectedProduct = IAP_PRODUCTS.find(product => product.id === selectedProductId) || IAP_PRODUCTS[0];
  const cta =
    busy
      ? unlockStage === 'purchasing'
        ? 'Purchasing'
        : action === 'modify'
          ? 'Unlocking'
          : 'Rendering'
      : action === 'share'
        ? `Buy ${selectedProduct.shortLabel} and share`
        : action === 'modify'
          ? `Buy ${selectedProduct.shortLabel} to modify`
        : `Buy ${selectedProduct.shortLabel}`;
  const paywallTitle = action === 'modify' ? 'Modify this reel with prompts.' : 'Save without watermark.';
  const paywallText =
    action === 'modify'
      ? 'Unlock prompt edits, clean export, and new cuts for this wedding.'
      : 'Choose one export or keep editing this wedding with a pack.';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.paywallBackdrop}>
        <View style={styles.paywallCard}>
          <Text style={styles.paywallKicker}>{action === 'modify' ? 'Prompt edit' : 'Export'}</Text>
          <Text style={styles.paywallTitle}>{paywallTitle}</Text>
          <Text style={styles.paywallText}>{paywallText}</Text>
          <View style={styles.paywallProductList}>
            {IAP_PRODUCTS.map(product => {
              const storeProduct = storeProducts.find(item => item.id === product.id);
              const selected = product.id === selectedProductId;
              return (
                <Pressable
                  key={product.id}
                  accessibilityRole="button"
                  accessibilityLabel={product.label}
                  style={[styles.paywallProduct, selected && styles.paywallProductSelected]}
                  onPress={() => onSelectProduct(product.id)}
                  disabled={busy}>
                  <View style={[styles.paywallProductRadio, selected && styles.paywallProductRadioSelected]}>
                    {selected ? <View style={styles.paywallProductRadioDot} /> : null}
                  </View>
                  <View style={styles.paywallProductCopy}>
                    <Text style={styles.paywallProductTitle}>{product.label}</Text>
                    <Text style={styles.paywallProductMeta}>{product.description}</Text>
                  </View>
                  <Text style={styles.paywallProductPrice}>{storeProduct?.price || product.fallbackPrice}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.paywallMiniFeatures}>
            <PaywallFeature icon="noWatermark" label="No watermark" />
            <PaywallFeature icon="export" label="HD MP4" />
            <PaywallFeature icon="reelsReady" label="Reels ready" />
          </View>
          {busy ? (
            <View style={styles.paywallProgress}>
              <ActivityIndicator color={UI.rose} />
              <Text style={styles.paywallProgressText}>{unlockStageLabel(unlockStage)}</Text>
            </View>
          ) : null}
          <Button label={cta} onPress={() => onUnlock(selectedProduct.id)} disabled={busy} />
          <Button label="Not now" variant="secondary" onPress={onClose} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

function PaywallFeature({icon, label}: {icon: IconName; label: string}) {
  return (
    <View style={styles.paywallFeature}>
      <View style={styles.paywallFeatureIcon}>
        <IconGlyph name={icon} size={36} tintColor="#FFFFFF" />
      </View>
      <Text style={styles.paywallFeatureText}>{label}</Text>
    </View>
  );
}

function MyReelScreen() {
  const {state, setState} = useAppState();
  const project = state.project;
  const outputUrl = state.finalPlaybackUrl || state.previewPlaybackUrl || state.playbackUrl || undefined;
  const storageUrl = normalizeLocalExportUrl(state.finalJob?.output_url || state.previewJob?.output_url || state.renderJob?.output_url);
  const reelJob = state.finalJob || state.previewJob || state.renderJob;
  const reelMeta = state.finalPlaybackUrl ? 'HD no watermark' : 'Watermarked preview';
  const projectClipCount = state.localAssets.length || state.assets.length;
  const projectClipLabel = projectClipCount === 1 ? '1 moment' : `${projectClipCount} moments`;
  const projectTitle = project?.couple_names || state.details.coupleNames || 'Wedding project';

  useEffect(() => {
    if (state.finalJob?.status === 'ready' && isPlaybackUrlExpired(state.finalPlaybackUrlExpiresAt) && state.project?.entitlement_status === 'active') {
      getProjectFinalPlayback(state.project.id)
        .then(playback =>
          setState(current => ({
            ...current,
            finalPlaybackUrl: playback.url,
            finalPlaybackUrlExpiresAt: playback.expires_at,
          })),
        )
        .catch(() => undefined);
      return;
    }
    if (state.previewJob?.status !== 'ready' || !isPlaybackUrlExpired(state.previewPlaybackUrlExpiresAt)) {
      return;
    }
    const playbackPromise = state.project
      ? getProjectPreviewPlayback(state.project.id)
      : getRenderJobPlayback(state.previewJob.id);
    playbackPromise
      .then(playback =>
        setState(current => ({
          ...current,
          playbackUrl: playback.url,
          playbackUrlExpiresAt: playback.expires_at,
          previewPlaybackUrl: playback.url,
          previewPlaybackUrlExpiresAt: playback.expires_at,
        })),
      )
      .catch(() => undefined);
  }, [
    setState,
    state.finalJob?.status,
    state.finalPlaybackUrlExpiresAt,
    state.previewJob?.id,
    state.previewJob?.status,
    state.previewPlaybackUrlExpiresAt,
    state.project,
  ]);

  function shareProjectInvite() {
    if (!project) {
      Alert.alert('No project yet', 'Start a video before sharing guest access.');
      return;
    }
    Share.share({
      title: 'VowFrame invite',
      message: `Upload wedding moments in VowFrame. Invite code: ${project.invite_code}`,
    }).catch(() => undefined);
  }

  return (
    <Screen>
      <Text style={styles.title}>Reels</Text>
      {project ? (
        <View style={styles.projectHubCard}>
          <View style={styles.projectHubHeader}>
            <View style={styles.projectHubTitleBlock}>
              <Text style={styles.projectHubLabel}>Current project</Text>
              <Text style={styles.projectHubTitle}>{projectTitle}</Text>
            </View>
            <View style={styles.projectHubStatusPill}>
              <Text style={styles.projectHubStatusText}>{project.entitlement_status === 'active' ? 'Unlocked' : 'Preview'}</Text>
            </View>
          </View>
          <View style={styles.projectHubStats}>
            <View style={styles.projectHubStat}>
              <Text style={styles.projectHubStatLabel}>Invite code</Text>
              <Text style={styles.projectHubInviteCode}>{project.invite_code}</Text>
            </View>
            <View style={styles.projectHubStat}>
              <Text style={styles.projectHubStatLabel}>Moments</Text>
              <Text style={styles.projectHubStatValue}>{projectClipLabel}</Text>
            </View>
            <View style={styles.projectHubStat}>
              <Text style={styles.projectHubStatLabel}>Reel</Text>
              <Text style={styles.projectHubStatValue}>{reelJob ? reelJob.status : 'Not cut'}</Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Share invite code ${project.invite_code}`}
            style={styles.projectHubShareButton}
            onPress={shareProjectInvite}>
            <Text style={styles.projectHubShareText}>Share invite</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No project yet</Text>
          <Text style={styles.bodyText}>Start a video to create a project, invite guests, and collect moments.</Text>
        </View>
      )}
      {reelJob ? (
        <View style={styles.myReelCard}>
          {outputUrl ? (
            <VideoPreviewCard
              outputUrl={outputUrl}
              title={state.spec?.title || state.details.coupleNames || 'Wedding reel'}
              meta={reelMeta}
              size="compact"
            />
          ) : (
            <View style={styles.reelThumb}>
              <Text style={styles.reelThumbText}>MP4</Text>
            </View>
          )}
          <View style={styles.reelText}>
            <Text style={styles.cardTitle}>{state.spec?.title || state.details.coupleNames || 'Wedding reel'}</Text>
            <Text style={styles.bodyText}>{reelJob.status} - {outputUrl || storageUrl || 'No output yet'}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No reel yet</Text>
          <Text style={styles.bodyText}>Open a guest drop and cut your first reel.</Text>
        </View>
      )}
    </Screen>
  );
}

function VideoPreviewCard({
  outputUrl,
  title,
  meta,
  size,
  onError,
}: {
  outputUrl?: string;
  title: string;
  meta: string;
  size: 'large' | 'compact';
  onError?: () => void;
}) {
  return (
    <View style={[styles.reelPreview, size === 'large' && styles.reelPreviewLarge, size === 'compact' && styles.reelPreviewCompact]}>
      {outputUrl ? (
        <Video
          source={{uri: outputUrl}}
          style={styles.reelVideo}
          resizeMode="cover"
          controls
          paused
          onError={onError}
        />
      ) : (
        <Image source={UI_ASSETS.previewPlaceholder} style={styles.reelVideo} />
      )}
      <View pointerEvents="none" style={styles.reelScrim} />
      <View style={styles.reelPreviewInner} pointerEvents="none">
        <Text style={[styles.reelPreviewTitle, size === 'compact' && styles.reelPreviewTitleCompact]}>{title}</Text>
        <Text style={styles.reelPreviewMeta}>{meta}</Text>
      </View>
      {size === 'compact' ? (
        <View pointerEvents="none" style={styles.readyBadge}>
          <Text style={styles.readyBadgeText}>Ready</Text>
        </View>
      ) : null}
    </View>
  );
}

function SettingsScreen() {
  const {state, setState} = useAppState();
  const project = state.project;
  const [showPurchases, setShowPurchases] = useState(false);
  const activeProduct = IAP_PRODUCTS.find(product => product.id === state.project?.product_id);
  const exportValue = state.project?.entitlement_status === 'active'
    ? activeProduct?.label || 'Purchased'
    : state.project
      ? 'Available after purchase'
      : 'Preview first';

  function shareInvite() {
    if (!project) {
      Alert.alert('No invite code', 'Start from an invite before sharing guest access.');
      return;
    }
    Share.share({
      title: 'VowFrame invite',
      message: `Upload wedding moments in VowFrame. Invite code: ${project.invite_code}`,
    }).catch(() => undefined);
  }

  function clearLocalSession() {
    Alert.alert(
      'Clear this device?',
      'This removes the current local session from this phone. Uploaded files and server records are not deleted.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => setState(current => ({...initialState, templates: current.templates})),
        },
      ],
    );
  }

  if (showPurchases) {
    return <PurchaseScreen onBack={() => setShowPurchases(false)} />;
  }

  return (
    <Screen>
      <View style={styles.settingsHeader}>
        <Text style={styles.settingsTitle}>Settings</Text>
      </View>

      {project ? (
        <SettingsSection title="Invite">
          <SettingRow
            label="Invite code"
            value={project.invite_code}
            actionLabel="Share"
            onPress={shareInvite}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title="Purchases">
        <SettingRow label="Modify & export" value={exportValue} actionLabel="Open" onPress={() => setShowPurchases(true)} />
      </SettingsSection>

      <SettingsSection title="Help">
        <SettingRow label="Support" value="support@vowframe.app" actionLabel="Email" onPress={() => Alert.alert('Support', 'support@vowframe.app')} compact />
        <SettingRow label="Privacy" value="Policy" actionLabel="Open" onPress={() => Alert.alert('Privacy', 'Privacy policy will open on launch site.')} />
        <SettingRow label="Terms" value="Terms" actionLabel="Open" onPress={() => Alert.alert('Terms', 'Terms of service will open on launch site.')} />
      </SettingsSection>

      <SettingsSection title="Local data">
        <Pressable accessibilityRole="button" style={styles.clearSessionRow} onPress={clearLocalSession}>
          <Text style={styles.clearSessionText}>Clear local session</Text>
        </Pressable>
      </SettingsSection>
    </Screen>
  );
}

function PurchaseScreen({onBack}: {onBack: () => void}) {
  const {state, setState} = useAppState();
  const [selectedIapProductId, setSelectedIapProductId] = useState<IapProductId>('com.aigcteacher.vowframeapp.singleexport');
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const storeProducts = useStoreProducts(true);
  const activeProduct = IAP_PRODUCTS.find(product => product.id === state.project?.product_id);
  const selectedProduct = IAP_PRODUCTS.find(product => product.id === selectedIapProductId) || IAP_PRODUCTS[0];
  const selectedStoreProduct = storeProducts.find(product => product.id === selectedProduct.id);
  const unlocked = state.project?.entitlement_status === 'active';
  const statusValue = unlocked ? activeProduct?.label || 'Purchased' : state.project ? 'Ready to unlock' : 'Preview required';

  async function buyExport() {
    if (!state.project) {
      Alert.alert('Preview first', 'Create a preview before buying an export. The purchase is attached to that reel.');
      return;
    }
    if (unlocked) {
      Alert.alert('Already unlocked', 'This reel already has an export purchase.');
      return;
    }
    try {
      setPurchaseBusy(true);
      const purchase = await purchaseIapProduct(selectedProduct.id);
      const entitlement = await verifyApplePurchase({
        project_id: state.project.id,
        product_id: purchase.product_id,
        transaction_id: purchase.transaction_id,
        original_transaction_id: purchase.original_transaction_id,
      });
      setState(current => ({...current, project: entitlement.project}));
      Alert.alert('Export unlocked', 'Open Preview when you are ready to render and save the clean reel.');
    } catch (caught) {
      Alert.alert('Purchase failed', caught instanceof Error ? caught.message : 'Unable to complete purchase.');
    } finally {
      setPurchaseBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.purchaseTopBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Settings" style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>‹</Text>
        </Pressable>
        <Text style={styles.purchaseTopTitle}>Purchases</Text>
        <View style={styles.backButtonSpacer} />
      </View>

      <View style={styles.purchaseHero}>
        <Text style={styles.purchaseTitle}>Choose your export.</Text>
        <Text style={styles.purchaseText}>Buy one clean reel, or unlock multiple exports for this wedding.</Text>
      </View>

      <View style={styles.purchaseStatusRow}>
        <Text style={styles.purchaseStatusLabel}>Status</Text>
        <Text style={styles.purchaseStatusValue}>{statusValue}</Text>
      </View>

      <View style={styles.purchaseProductList}>
        {IAP_PRODUCTS.map(product => {
          const storeProduct = storeProducts.find(item => item.id === product.id);
          const selected = product.id === selectedIapProductId;
          return (
            <Pressable
              key={product.id}
              accessibilityRole="button"
              accessibilityLabel={product.label}
              style={[styles.purchaseProduct, selected && styles.purchaseProductSelected]}
              onPress={() => setSelectedIapProductId(product.id)}
              disabled={purchaseBusy || unlocked}>
              <View style={[styles.paywallProductRadio, selected && styles.paywallProductRadioSelected]}>
                {selected ? <View style={styles.paywallProductRadioDot} /> : null}
              </View>
              <View style={styles.paywallProductCopy}>
                <Text style={styles.paywallProductTitle}>{product.label}</Text>
                <Text style={styles.paywallProductMeta}>{product.description}</Text>
              </View>
              <Text style={styles.paywallProductPrice}>{storeProduct?.price || product.fallbackPrice}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.purchaseFinePrint}>
        <PaywallFeature icon="noWatermark" label="No watermark" />
        <PaywallFeature icon="export" label="HD MP4" />
        <PaywallFeature icon="reelsReady" label="Reels ready" />
      </View>

      <View style={styles.purchaseBottomCta}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Buy ${selectedProduct.label}`}
          style={[styles.settingsBuyButton, (purchaseBusy || unlocked) && styles.buttonDisabled]}
          onPress={buyExport}
          disabled={purchaseBusy || unlocked}>
          <Text style={styles.settingsBuyButtonText}>
            {unlocked ? 'Unlocked' : purchaseBusy ? 'Purchasing' : `Buy ${selectedStoreProduct?.price || selectedProduct.fallbackPrice}`}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function SettingsSection({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.settingsGroup}>
      <Text style={styles.settingsGroupLabel}>{title}</Text>
      {children}
    </View>
  );
}

function SettingRow({
  label,
  value,
  actionLabel,
  onPress,
  compact,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onPress?: () => void;
  compact?: boolean;
}) {
  const rowContent = (
    <>
      <View style={styles.settingTextBlock}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={[styles.settingValue, compact && styles.settingValueCompact]} numberOfLines={compact ? 2 : 1}>
          {value}
        </Text>
      </View>
      {actionLabel ? <Text style={styles.settingsActionText}>{actionLabel}</Text> : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable accessibilityRole="button" style={styles.settingRow} onPress={onPress}>
        {rowContent}
      </Pressable>
    );
  }
  return <View style={styles.settingRow}>{rowContent}</View>;
}

function Screen({children}: {children: React.ReactNode}) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#8A8883" />
    </View>
  );
}

function PhotoWallGrid({
  assets,
  onOpen,
  emptyAction,
}: {
  assets: LocalAsset[];
  onOpen: (asset: LocalAsset) => void;
  emptyAction: () => void;
}) {
  const tiles: LocalAsset[] = assets.length
    ? assets
    : Array.from({length: 5}, (_, index) => ({id: `empty-${index}`, uri: '', type: 'photo', tag: 'moment', tags: ['moment']}));

  if (!assets.length) {
    return (
      <Pressable accessibilityRole="button" style={styles.emptyWallCard} onPress={emptyAction}>
        <Image source={UI_ASSETS.emptyPhotoWall} style={styles.emptyWallImage} />
        <View style={styles.emptyWallScrim} />
        <View style={styles.emptyWallCopy}>
          <Text style={styles.emptyWallTitle}>Start from camera roll</Text>
          <Text style={styles.emptyWallText}>Photos and videos from the day.</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.wall}>
      {tiles.map((asset, index) => {
        const hasMedia = Boolean(asset.uri);
        const tileStyle = [styles.tile, tileStyleForAsset(asset, hasMedia, index)];
        return (
          <Pressable
            key={asset.id}
            accessibilityRole="button"
            style={tileStyle}
            onPress={() => {
              if (hasMedia) {
                onOpen(asset);
                return;
              }
              emptyAction();
            }}>
            {hasMedia ? (
              <MomentVisual asset={asset} />
            ) : (
              <View style={styles.emptyTile}>
                <Text style={styles.emptyLabel}>Add moment</Text>
              </View>
            )}
            {asset.type === 'video' && hasMedia ? (
              <View style={styles.videoBadge}>
                <View style={styles.videoBadgeTriangle} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function MomentVisual({asset}: {asset: LocalAsset}) {
  if (asset.type === 'video') {
    return (
      <View style={styles.videoTile}>
        <View style={styles.videoLine} />
        <Text style={styles.videoTileText}>VIDEO</Text>
      </View>
    );
  }
  return <Animated.Image source={{uri: asset.uri}} style={styles.tileImage} />;
}

function TagChip({label, selected, onPress}: {label: string; selected?: boolean; onPress: () => void}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.tagChip, selected && styles.tagChipSelected]} onPress={onPress}>
      <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function SoundTrackRow({
  title,
  subtitle,
  selected,
  isPlaying,
  onPreview,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  isPlaying: boolean;
  onPreview: () => void;
  onPress: () => void;
}) {
  return (
    <View style={[styles.soundTrackRow, selected && styles.soundTrackRowSelected]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select music ${title}`}
        style={styles.soundTrackSelectArea}
        onPress={onPress}>
        <View style={[styles.soundTrackDot, selected && styles.soundTrackDotSelected]} />
        <View style={styles.soundTrackText}>
          <Text style={styles.soundTrackTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.soundTrackMeta} numberOfLines={1}>{subtitle}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isPlaying ? 'Pause' : 'Preview'} music ${title}`}
        style={[styles.soundPreviewButton, isPlaying && styles.soundPreviewButtonPlaying]}
        onPress={onPreview}>
        <Text style={[styles.soundPreviewText, isPlaying && styles.soundPreviewTextPlaying]}>
          {isPlaying ? 'Pause' : 'Play'}
        </Text>
      </Pressable>
    </View>
  );
}

function StageRow({label, active, done}: {label: string; active: boolean; done: boolean}) {
  return (
    <View style={[styles.stageRow, active && styles.stageRowActive]}>
      <View style={[styles.stageDot, active && styles.stageDotActive, done && styles.stageDotDone]}>
        {active ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
        {!active && done ? (
          <Image source={ICON_ASSETS.check} style={styles.stageCheckIcon} resizeMode="contain" />
        ) : null}
      </View>
      <Text style={[styles.stageLabel, (active || done) && styles.stageLabelActive]}>{label}</Text>
    </View>
  );
}

function UploadProgressTray({progress}: {progress: UploadProgress}) {
  const total = Math.max(progress.total, 1);
  const ratio = Math.min(1, Math.max(0.06, progress.current / total));
  return (
    <View style={styles.uploadProgressTray}>
      <View style={styles.uploadProgressIcon}>
        <IconGlyph name="camera" size={36} />
      </View>
      <View style={styles.uploadProgressCopy}>
        <View style={styles.uploadProgressTextRow}>
          <Text style={styles.uploadProgressTitle}>{progress.label}</Text>
          <Text style={styles.uploadProgressCount}>{progress.current}/{total}</Text>
        </View>
        <View style={styles.uploadProgressTrack}>
          <View style={[styles.uploadProgressFill, {width: `${ratio * 100}%`}]} />
        </View>
      </View>
    </View>
  );
}

function renderStageFromJob(status: RenderJob['status']): RenderStage {
  if (status === 'queued' || status === 'provisioning' || status === 'retrying') {
    return 'provisioning';
  }
  if (status === 'uploading') {
    return 'uploading';
  }
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'failed' || status === 'preempted' || status === 'expired') {
    return 'failed';
  }
  return 'rendering';
}

function unlockStageFromJob(status: RenderJob['status']): UnlockStage {
  if (status === 'queued' || status === 'provisioning' || status === 'retrying') {
    return 'provisioning';
  }
  if (status === 'uploading') {
    return 'uploading';
  }
  if (status === 'ready') {
    return 'ready';
  }
  if (status === 'failed' || status === 'preempted' || status === 'expired') {
    return 'failed';
  }
  return 'rendering';
}

function unlockStageLabel(stage: UnlockStage) {
  if (stage === 'purchasing') {
    return 'Recording purchase';
  }
  if (stage === 'provisioning') {
    return 'Starting render';
  }
  if (stage === 'uploading') {
    return 'Uploading clean reel';
  }
  if (stage === 'ready') {
    return 'Clean reel ready';
  }
  if (stage === 'failed') {
    return 'Unlock needs a retry';
  }
  return 'Rendering clean reel';
}

function isTerminalRenderFailure(status: RenderJob['status']) {
  return status === 'failed' || status === 'preempted' || status === 'expired';
}

function isStageDone(currentStage: RenderStage, stage: RenderStage) {
  const order: RenderStage[] = ['story', 'beats', 'provisioning', 'rendering', 'uploading', 'ready'];
  return order.indexOf(currentStage) > order.indexOf(stage);
}

function delay(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function isPlaybackUrlExpired(expiresAt?: string | null) {
  if (!expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs - Date.now() < 60_000;
}

function Button({
  label,
  onPress,
  disabled,
  variant = 'primary',
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'secondaryDark';
  icon?: IconName;
}) {
  const iconTint = variant === 'secondary' ? UI.ink : '#FFFFFF';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'secondaryDark' && styles.secondaryDarkButton,
        disabled && styles.buttonDisabled,
      ]}>
      {icon ? <IconGlyph name={icon} size={22} tintColor={iconTint} /> : null}
      <Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconGlyph({name, size = 24}: {name: IconName; size?: number; tintColor?: string}) {
  return <Image source={ICON_ASSETS[name]} style={[styles.iconImage, {width: size, height: size}]} resizeMode="contain" />;
}

function TabGlyph({name, focused}: {name: 'moments' | 'reels' | 'settings'; focused: boolean}) {
  return (
    <View style={[styles.tabGlyph, focused && styles.tabGlyphActive]}>
      <IconGlyph name={name} size={focused ? 40 : 34} />
    </View>
  );
}

function numberFromMetadata(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function assetDimensionsFromUnknown(metadata?: Record<string, unknown>) {
  if (!metadata) {
    return {};
  }
  const width = numberFromMetadata(metadata.width);
  const height = numberFromMetadata(metadata.height);
  return width && height ? {width, height} : {};
}

function tileStyleForAsset(asset: LocalAsset, hasMedia: boolean, index: number) {
  if (!hasMedia) {
    if (index === 1) {
      return styles.tilePortrait;
    }
    if (index === 4) {
      return styles.tileTall;
    }
    return undefined;
  }

  if (!asset.width || !asset.height) {
    return undefined;
  }
  const ratio = asset.width / asset.height;
  if (ratio >= 1.25) {
    return styles.tileLandscape;
  }
  if (ratio <= 0.68) {
    return styles.tilePortrait;
  }
  if (ratio >= 0.86 && ratio <= 1.14) {
    return styles.tileSquare;
  }
  return undefined;
}

function localAssetFromAsset(asset: Asset, uri = asset.url, dimensionOverride?: {width?: number; height?: number}): LocalAsset {
  const visualAnalysis = (asset.analysis?.visual as Record<string, unknown> | undefined) || {};
  const analysisTags = Array.isArray(visualAnalysis.detected_tags)
    ? (visualAnalysis.detected_tags as string[])
    : [];
  const tags = Array.from(new Set([asset.tag, ...analysisTags].filter(Boolean)));
  const dimensions = dimensionOverride?.width && dimensionOverride.height
    ? dimensionOverride
    : assetDimensionsFromUnknown(asset.metadata);
  return {
    id: asset.id,
    uri,
    type: asset.type,
    tag: asset.tag,
    tags: tags.length ? tags : [asset.tag],
    width: dimensions.width,
    height: dimensions.height,
    caption: asset.caption || undefined,
    description: asset.description || undefined,
  };
}

function mergeAssetsIntoState(state: AppState, incomingAssets: Asset[]): AppState {
  const incomingById = new Map(incomingAssets.map(asset => [asset.id, asset]));
  const existingAssetIds = new Set(state.assets.map(asset => asset.id));
  const nextAssets = state.assets.map(asset => incomingById.get(asset.id) || asset);
  nextAssets.push(...incomingAssets.filter(asset => !existingAssetIds.has(asset.id)));

  const existingLocalIds = new Set(state.localAssets.map(asset => asset.id));
  const nextLocalAssets = state.localAssets.map(asset => {
    const incoming = incomingById.get(asset.id);
    return incoming && (incoming.type === 'photo' || incoming.type === 'video')
      ? localAssetFromAsset(incoming, asset.uri)
      : asset;
  });
  nextLocalAssets.push(
    ...incomingAssets
      .filter(asset => asset.type === 'photo' || asset.type === 'video')
      .filter(asset => !existingLocalIds.has(asset.id))
      .map(asset => localAssetFromAsset(asset)),
  );
  return {...state, assets: nextAssets, localAssets: nextLocalAssets};
}

function assetUpdatePayloadForTag(asset: Asset | undefined, tag: string) {
  const visual = ((asset?.analysis?.visual as Record<string, unknown> | undefined) || {});
  const oldTags = Array.isArray(visual.detected_tags) ? (visual.detected_tags as string[]) : [];
  return {
    tag,
    analysis: {
      ...(asset?.analysis || {}),
      visual: {
        ...visual,
        detected_tags: uniqueTags([tag, ...oldTags]),
      },
    },
  };
}

function applyTagToState(state: AppState, assetId: string, tag: string): AppState {
  const nextTag = normalizeTagValue(tag);
  if (!nextTag) {
    return state;
  }
  return {
    ...state,
    localAssets: state.localAssets.map(asset =>
      asset.id === assetId
        ? {...asset, tag: nextTag, tags: uniqueTags([nextTag, ...asset.tags])}
        : asset,
    ),
    assets: state.assets.map(asset => {
      if (asset.id !== assetId) {
        return asset;
      }
      const visual = ((asset.analysis?.visual as Record<string, unknown> | undefined) || {});
      const oldTags = Array.isArray(visual.detected_tags) ? (visual.detected_tags as string[]) : [];
      return {
        ...asset,
        tag: nextTag,
        analysis: {
          ...(asset.analysis || {}),
          visual: {
            ...visual,
            detected_tags: uniqueTags([nextTag, ...oldTags]),
          },
        },
      };
    }),
  };
}

function normalizeTagValue(tag: string) {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTagValue(tag);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function removeAssetFromState(state: AppState, assetId: string): AppState {
  return {
    ...state,
    localAssets: state.localAssets.filter(asset => asset.id !== assetId),
    assets: state.assets.filter(asset => asset.id !== assetId),
    advisorOptions: [],
    selectedOptionId: null,
    renderStage: 'idle',
    spec: null,
    renderJob: null,
    previewJob: null,
    finalJob: null,
    playbackUrl: null,
    playbackUrlExpiresAt: null,
    previewPlaybackUrl: null,
    previewPlaybackUrlExpiresAt: null,
    finalPlaybackUrl: null,
    finalPlaybackUrlExpiresAt: null,
    unlockStage: 'idle',
  };
}

function detailsFromAnswers(answers: InterviewAnswer[]): WeddingDetails {
  const byId = Object.fromEntries(answers.map(answer => [answer.questionId, answer.answer]));
  return {
    coupleNames: byId.couple || 'Our Wedding',
    weddingDate: '',
    location: byId.story || '',
  };
}

function stylePresetFromAnswers(answers: InterviewAnswer[]) {
  const styleAnswer = answers.find(answer => answer.questionId === 'style')?.answer || '';
  const normalized = styleAnswer.trim().toLowerCase();
  return (
    STYLE_PRESET_CHOICES.find(choice => choice.label.toLowerCase() === normalized || choice.id === normalized) ||
    STYLE_PRESET_CHOICES[0]
  );
}

function upsertInterviewAnswer(
  answers: InterviewAnswer[],
  questionId: string,
  question: string,
  answer: string,
): InterviewAnswer[] {
  return [
    ...answers.filter(item => item.questionId !== questionId),
    {questionId, question, answer},
  ];
}

function patchSpecForInterview(spec: VideoSpec, option: AdvisorOption, appState: AppState): VideoSpec {
  const localById = new Map(appState.localAssets.map(asset => [asset.id, asset]));
  const answers = Object.fromEntries(appState.interviewAnswers.map(answer => [answer.questionId, answer.answer]));
  const stylePreset = stylePresetFromAnswers(appState.interviewAnswers);
  const patchedAssets = spec.assets.map(asset => {
    const local = localById.get(asset.id);
    if (!local) {
      return asset;
    }
    return {
      ...asset,
      tag: local.tag,
      caption: local.caption || asset.caption,
      analysis: {
        ...(asset.analysis || {}),
        visual: {
          ...(((asset.analysis?.visual as Record<string, unknown> | undefined) || {})),
          detected_tags: local.tags,
        },
      },
    };
  });
  return {
    ...spec,
    title: `${appState.details.coupleNames || 'Wedding'} - ${option.title}`,
    assets: patchedAssets,
    music_asset_id: appState.selectedMusicAssetId,
    style: {
      ...spec.style,
      primary_color: stylePreset.color || option.primary_color,
      photo_motion: option.photo_motion,
      transition: option.transition,
      music_volume: option.music_volume,
      style_preset_id: stylePreset.id,
      filter_preset: stylePreset.filter,
    },
    timeline: spec.timeline.map(scene => {
      if (scene.type === 'title') {
        return {
          ...scene,
          text: appState.details.coupleNames || answers.couple || scene.text,
          caption: stylePreset.label || scene.caption,
          parameters: {
            ...(scene.parameters || {}),
            style_preset_id: stylePreset.id,
            filter_preset: stylePreset.filter,
            interview: answers,
          },
        };
      }
      if ((scene.type === 'photo' || scene.type === 'video') && scene.asset_id) {
        const local = localById.get(scene.asset_id);
        return {
          ...scene,
          caption: local?.caption || local?.tag || scene.caption,
          motion: option.photo_motion,
          transition: option.transition,
          parameters: {
            ...(scene.parameters || {}),
            style_preset_id: stylePreset.id,
            filter_preset: stylePreset.filter,
            tags: local?.tags || [],
            beat_sync: appState.beatSyncEnabled,
            interview: answers,
          },
        };
      }
      if (scene.type === 'ending') {
        return {
          ...scene,
          text: answers.story || scene.text,
          caption: answers.pacing || scene.caption,
          parameters: {
            ...(scene.parameters || {}),
            style_preset_id: stylePreset.id,
            filter_preset: stylePreset.filter,
            interview: answers,
          },
        };
      }
      return scene;
    }),
  };
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: UI.bg},
  screen: {padding: 16, paddingBottom: 88, gap: 14},
  content: {padding: 18, paddingBottom: 118, gap: 16},
  photoWallScreen: {flex: 1, backgroundColor: UI.bg},
  wallContent: {padding: 14, paddingBottom: 118, gap: 12},
  resultContent: {padding: 18, paddingTop: 14, paddingBottom: 60, gap: 18, backgroundColor: UI.dark},
  homeSafe: {flex: 1, backgroundColor: '#09090A'},
  homeFrame: {flex: 1, overflow: 'hidden', backgroundColor: UI.dark},
  homeMedia: {...StyleSheet.absoluteFillObject, width: '100%', height: '100%'},
  homeScrim: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.20)'},
  homeTopBar: {position: 'absolute', left: 20, right: 20, top: 58, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  homeWordmark: {color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '900', letterSpacing: 0},
  homeRecordDot: {width: 11, height: 11, borderRadius: 6, backgroundColor: UI.rose},
  homeActionPanel: {position: 'absolute', left: 14, right: 14, bottom: 30, gap: 12},
  homeInviteStack: {gap: 10},
  homeButton: {minHeight: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18},
  homePrimaryButton: {backgroundColor: '#FFFFFF'},
  homeSecondaryButton: {backgroundColor: 'rgba(14,14,16,0.48)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)'},
  homeButtonDisabled: {opacity: 0.54},
  homePrimaryText: {color: UI.ink, fontSize: 16, lineHeight: 20, fontWeight: '900'},
  homeSecondaryText: {color: '#FFFFFF', fontSize: 15, lineHeight: 19, fontWeight: '900'},
  homeInviteInput: {
    minHeight: 58,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(14,14,16,0.54)',
    paddingHorizontal: 18,
    color: '#FFFFFF',
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  homeHandleRow: {alignItems: 'center', paddingBottom: 2},
  homeHandle: {width: 54, height: 5, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.34)'},
  topBar: {minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  brandLockup: {flexDirection: 'row', alignItems: 'center', gap: 8},
  brandIcon: {width: 28, height: 28, borderRadius: 7},
  wordmark: {color: UI.ink, fontSize: 22, fontWeight: '900'},
  wordmarkAccent: {color: UI.rose},
  screenKicker: {color: UI.muted, fontSize: 13, fontWeight: '700', marginTop: 2},
  tinyPill: {borderRadius: 999, backgroundColor: UI.ink, paddingHorizontal: 12, paddingVertical: 8},
  tinyPillText: {color: '#FFFFFF', fontSize: 12, fontWeight: '900'},
  dropHero: {height: 246, borderRadius: 8, overflow: 'hidden', backgroundColor: UI.dark, justifyContent: 'flex-end'},
  dropHeroImage: {...StyleSheet.absoluteFillObject, width: '100%', height: '100%', resizeMode: 'cover'},
  dropHeroScrim: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)'},
  dropHeroCopy: {padding: 18, gap: 5},
  dropHeroTitle: {color: '#FFFFFF', fontSize: 30, lineHeight: 33, fontWeight: '900', maxWidth: 290},
  heroPanel: {gap: 10, paddingBottom: 4},
  momentsTopBar: {minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12},
  momentsTitle: {color: UI.ink, fontSize: 28, lineHeight: 32, fontWeight: '800'},
  momentsMeta: {color: UI.muted, fontSize: 13, lineHeight: 18, fontWeight: '600'},
  sampleLink: {paddingHorizontal: 3, paddingVertical: 8},
  sampleLinkText: {color: UI.ink, fontSize: 13, lineHeight: 17, fontWeight: '700'},
  momentsGuide: {
    minHeight: 60,
    borderRadius: 8,
    backgroundColor: '#F0F0EC',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  momentsGuideItem: {flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', gap: 2},
  momentsGuideDivider: {width: StyleSheet.hairlineWidth, height: 26, backgroundColor: '#D4D3CC'},
  momentsGuideTitle: {color: UI.ink, fontSize: 12, lineHeight: 15, fontWeight: '800', textAlign: 'center'},
  momentsGuideTitleMuted: {color: UI.muted},
  title: {color: UI.ink, fontSize: 30, lineHeight: 33, fontWeight: '900'},
  titleSmall: {color: UI.ink, fontSize: 24, lineHeight: 29, fontWeight: '900'},
  subtle: {color: UI.muted, fontSize: 15, lineHeight: 21},
  subtleOnDark: {color: '#F3F3EF', fontSize: 16, lineHeight: 22, fontWeight: '700'},
  inlineActions: {flexDirection: 'row', gap: 10, marginTop: 4},
  sectionLabel: {color: UI.ink, fontSize: 13, fontWeight: '900'},
  inviteCard: {borderRadius: 8, backgroundColor: UI.surface, padding: 16, gap: 12, borderWidth: 1, borderColor: UI.line},
  inviteCode: {color: UI.rose, fontSize: 44, lineHeight: 47, fontWeight: '900', letterSpacing: 0, textAlign: 'center'},
  inlineInviteCard: {borderRadius: 8, backgroundColor: UI.surface, padding: 12, gap: 4, borderWidth: 1, borderColor: UI.line},
  inlineInviteCode: {color: UI.ink, fontSize: 24, lineHeight: 28, fontWeight: '900', letterSpacing: 0},
  inviteInput: {minHeight: 64, borderRadius: 8, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.surface, paddingHorizontal: 14, color: UI.ink, fontSize: 28, fontWeight: '900', letterSpacing: 0, textAlign: 'center'},
  optionCard: {borderRadius: 8, backgroundColor: UI.surface, borderWidth: 1, borderColor: UI.line, paddingHorizontal: 12, paddingVertical: 11, gap: 12, flexDirection: 'row', alignItems: 'center'},
  optionCardActive: {borderColor: UI.ink, backgroundColor: '#F0F0EC'},
  optionText: {flex: 1, gap: 3},
  formatIconBox: {width: 42, height: 42, borderRadius: 8, backgroundColor: UI.dark, alignItems: 'center', justifyContent: 'center'},
  formatIconBoxActive: {backgroundColor: UI.ink},
  optionChevron: {color: UI.muted, fontSize: 22, lineHeight: 24, fontWeight: '900'},
  customTagRow: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  tagInput: {flex: 1, minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.surface, paddingHorizontal: 12, color: UI.ink, fontSize: 15},
  wall: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'flex-start'},
  tile: {width: '31.8%', height: 108, borderRadius: 8, overflow: 'hidden', backgroundColor: UI.chrome},
  tileHero: {width: '65.5%', height: 196},
  tileFeature: {width: '48.8%', height: 218},
  tileLandscape: {width: '65.5%', height: 118},
  tilePortrait: {width: '48.8%', height: 218},
  tileSquare: {width: '31.8%', height: 112},
  tileShort: {height: 82},
  tileWide: {width: '65.5%', height: 118},
  tileTall: {height: 136},
  tileImage: {width: '100%', height: '100%', resizeMode: 'cover'},
  emptyTile: {flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D0D0CB', borderStyle: 'dashed', backgroundColor: '#F0F0ED'},
  emptyLabel: {color: UI.muted, fontSize: 12, fontWeight: '900'},
  videoTile: {flex: 1, backgroundColor: UI.dark, justifyContent: 'flex-end', padding: 10},
  videoLine: {position: 'absolute', top: 16, left: 10, right: 10, height: 3, borderRadius: 2, backgroundColor: UI.rose},
  videoTileText: {color: '#FFFFFF', fontSize: 13, fontWeight: '900'},
  videoBadge: {position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.88)', alignItems: 'center', justifyContent: 'center'},
  videoBadgeTriangle: {
    width: 0,
    height: 0,
    marginLeft: 2,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: UI.ink,
  },
  photoNoteLarge: {position: 'absolute', left: 14, bottom: 14, borderRadius: 999, backgroundColor: UI.roseSoft, paddingHorizontal: 12, paddingVertical: 7},
  photoNoteText: {color: UI.roseInk, fontSize: 11, fontWeight: '900'},
  emptyWallCard: {height: 330, borderRadius: 8, overflow: 'hidden', backgroundColor: UI.dark},
  emptyWallImage: {...StyleSheet.absoluteFillObject, width: '100%', height: '100%', resizeMode: 'cover'},
  emptyWallScrim: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.20)'},
  emptyWallCopy: {position: 'absolute', left: 16, right: 16, bottom: 16, gap: 5},
  emptyWallTitle: {color: '#FFFFFF', fontSize: 25, lineHeight: 29, fontWeight: '800'},
  emptyWallText: {color: '#F4F4F0', fontSize: 14, lineHeight: 20, fontWeight: '600'},
  bottomCta: {paddingTop: 4},
  stickyCta: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    minHeight: 64,
    borderRadius: 999,
    padding: 6,
    backgroundColor: 'rgba(248,248,245,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(210,210,204,0.82)',
    flexDirection: 'row',
    gap: 7,
    shadowColor: '#D1D0CA',
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: -6},
  },
  momentsUploadProgress: {position: 'absolute', left: 14, right: 14, bottom: 84},
  momentsDockButton: {flex: 1, minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8},
  momentsDockPrimary: {backgroundColor: UI.surface},
  momentsDockNext: {backgroundColor: UI.ink},
  momentsDockDisabled: {backgroundColor: '#E2E1DB'},
  momentsDockPrimaryText: {color: UI.ink, fontSize: 14, lineHeight: 18, fontWeight: '800'},
  momentsDockNextText: {color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '800'},
  momentsDockNextTextDisabled: {color: UI.muted},
  detailPreview: {height: 420, borderRadius: 8, overflow: 'hidden', backgroundColor: UI.dark},
  tagCloud: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  tagChip: {borderRadius: 999, backgroundColor: UI.surface, borderWidth: 1, borderColor: UI.line, paddingHorizontal: 12, paddingVertical: 9},
  tagChipSelected: {backgroundColor: '#F0F0EC', borderColor: '#CFCFCA'},
  tagChipText: {color: '#3F3E3A', fontSize: 13, fontWeight: '800'},
  tagChipTextSelected: {color: UI.ink},
  field: {gap: 6},
  label: {color: UI.ink, fontSize: 14, fontWeight: '900'},
  input: {minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.surface, paddingHorizontal: 12, color: UI.ink, fontSize: 15},
  smallButton: {height: 46, borderRadius: 8, backgroundColor: UI.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  smallButtonText: {color: '#FFFFFF', fontSize: 13, fontWeight: '900'},
  deleteMomentRow: {minHeight: 50, alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D9D8D2'},
  deleteMomentText: {color: UI.roseInk, fontSize: 15, lineHeight: 20, fontWeight: '800'},
  soundContent: {padding: 14, paddingBottom: 118, gap: 12},
  soundStatusRow: {minHeight: 68, borderRadius: 8, backgroundColor: UI.dark, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 12},
  soundStatusIcon: {width: 42, height: 42, borderRadius: 21, backgroundColor: '#252528', alignItems: 'center', justifyContent: 'center'},
  soundStatusText: {flex: 1, gap: 2},
  soundStatusLabel: {color: '#A9A9A4', fontSize: 12, lineHeight: 16, fontWeight: '700'},
  soundStatusTitle: {color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontWeight: '800'},
  soundHint: {color: UI.muted, fontSize: 13, lineHeight: 18, fontWeight: '600', paddingHorizontal: 2},
  soundSettingRow: {
    minHeight: 56,
    borderRadius: 8,
    backgroundColor: UI.surface,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
  },
  soundRowText: {flex: 1, gap: 1},
  soundRowTitle: {color: UI.ink, fontSize: 15, lineHeight: 19, fontWeight: '800'},
  soundRowMeta: {color: UI.muted, fontSize: 12, lineHeight: 16, fontWeight: '700'},
  switch: {width: 54, height: 30, borderRadius: 999, backgroundColor: '#D2D2CC', padding: 3},
  switchOn: {backgroundColor: UI.ink},
  switchKnob: {width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF'},
  switchKnobOn: {transform: [{translateX: 24}]},
  audioPlayer: {width: 1, height: 1, opacity: 0},
  uploadAudioCard: {borderRadius: 8, backgroundColor: UI.roseSoft, borderWidth: 1, borderColor: '#ECB0BC', padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14},
  plusMark: {color: UI.ink, fontSize: 28, fontWeight: '900'},
  soundTrackList: {borderRadius: 8, overflow: 'hidden', backgroundColor: UI.surface},
  soundTrackRow: {
    minHeight: 64,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9D8D2',
  },
  soundTrackRowSelected: {backgroundColor: '#F0F0EC'},
  soundTrackSelectArea: {flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11},
  soundTrackDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: '#C9C8C2'},
  soundTrackDotSelected: {backgroundColor: UI.rose},
  soundTrackText: {flex: 1, gap: 2},
  soundTrackTitle: {color: UI.ink, fontSize: 15, lineHeight: 19, fontWeight: '800'},
  soundTrackMeta: {color: UI.muted, fontSize: 12, lineHeight: 16, fontWeight: '600'},
  soundPreviewButton: {minWidth: 58, minHeight: 34, borderRadius: 999, backgroundColor: '#F0F0EC', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12},
  soundPreviewButtonPlaying: {backgroundColor: UI.ink},
  soundPreviewText: {color: UI.ink, fontSize: 12, lineHeight: 16, fontWeight: '800'},
  soundPreviewTextPlaying: {color: '#FFFFFF'},
  soundDockPlus: {color: UI.ink, fontSize: 23, lineHeight: 24, fontWeight: '800', marginTop: -2},
  card: {borderRadius: 8, backgroundColor: UI.surface, padding: 14, gap: 10, borderWidth: 1, borderColor: UI.line},
  cardTitle: {color: UI.ink, fontSize: 16, fontWeight: '900'},
  bodyText: {color: '#3F3E3A', fontSize: 14, lineHeight: 19},
  metaText: {color: UI.rose, fontSize: 13, fontWeight: '900'},
  interviewHeader: {flexDirection: 'row', alignItems: 'center', gap: 12},
  avatar: {width: 48, height: 48, borderRadius: 24, backgroundColor: UI.ink, alignItems: 'center', justifyContent: 'center'},
  avatarText: {color: '#FFFFFF', fontSize: 14, fontWeight: '900'},
  interviewIntro: {flex: 1},
  progressDots: {flexDirection: 'row', gap: 8},
  progressDot: {height: 7, flex: 1, borderRadius: 7, backgroundColor: UI.line},
  progressDotActive: {backgroundColor: UI.ink},
  questionBubble: {alignSelf: 'flex-start', maxWidth: '86%', borderRadius: 8, backgroundColor: UI.ink, padding: 14},
  questionText: {color: '#FFFFFF', fontSize: 20, lineHeight: 25, fontWeight: '900'},
  answerBubble: {borderRadius: 8, backgroundColor: UI.surface, borderWidth: 1, borderColor: UI.line, padding: 12},
  answerInput: {minHeight: 110, color: UI.ink, fontSize: 17, lineHeight: 23, textAlignVertical: 'top'},
  quickReplies: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  quickReply: {borderRadius: 999, backgroundColor: '#F0F0EC', paddingHorizontal: 12, paddingVertical: 9},
  quickReplyText: {color: UI.ink, fontSize: 13, fontWeight: '900'},
  renderPanel: {gap: 10, paddingTop: 92},
  stageRow: {
    minHeight: 58,
    borderRadius: 8,
    backgroundColor: '#1B1B1E',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#343438',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stageRowActive: {borderColor: '#5B2730', backgroundColor: '#201B1F'},
  stageDot: {width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#6E6E72', alignItems: 'center', justifyContent: 'center'},
  stageDotActive: {width: 28, height: 28, borderRadius: 14, borderWidth: 0, backgroundColor: UI.rose},
  stageDotDone: {width: 30, height: 30, borderRadius: 8, borderWidth: 0, backgroundColor: 'transparent'},
  stageCheckIcon: {width: 30, height: 30},
  stageLabel: {color: '#8F8F8A', fontSize: 15, lineHeight: 20, fontWeight: '800'},
  stageLabelActive: {color: '#FFFFFF'},
  errorBox: {gap: 12, borderRadius: 8, backgroundColor: '#2A171C', padding: 14, borderWidth: 1, borderColor: '#6A2634'},
  errorText: {color: '#FFDCE3', fontSize: 14, lineHeight: 20, fontWeight: '800'},
  resultPanel: {gap: 14},
  previewReadyHeader: {minHeight: 48, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12},
  previewReadyTitle: {color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '800'},
  previewReadyMeta: {color: '#A9A9A4', fontSize: 13, lineHeight: 18, fontWeight: '600'},
  previewReadyPill: {borderRadius: 999, backgroundColor: '#F4F4F0', paddingHorizontal: 12, paddingVertical: 7},
  previewReadyPillText: {color: UI.ink, fontSize: 12, lineHeight: 15, fontWeight: '800'},
  previewActionDock: {
    minHeight: 64,
    borderRadius: 999,
    padding: 6,
    backgroundColor: '#1D1D20',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#343438',
    flexDirection: 'row',
    gap: 7,
  },
  previewDockButton: {flex: 1, minHeight: 52, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8},
  previewDockSecondary: {backgroundColor: '#2A2A2E'},
  previewDockPrimary: {backgroundColor: '#FFFFFF'},
  previewDockSecondaryText: {color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '800'},
  previewDockPrimaryText: {color: UI.ink, fontSize: 14, lineHeight: 18, fontWeight: '800'},
  previewLinkRow: {minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12},
  previewLinkText: {color: '#C9C9C2', fontSize: 13, lineHeight: 18, fontWeight: '700'},
  previewLinkTextDisabled: {color: '#6E6E72'},
  previewLinkDivider: {width: 3, height: 3, borderRadius: 2, backgroundColor: '#55555A'},
  reelPreview: {aspectRatio: 9 / 16, borderRadius: 8, backgroundColor: UI.dark, overflow: 'hidden', justifyContent: 'flex-end', padding: 18, borderWidth: 1, borderColor: '#343438'},
  reelPreviewLarge: {height: 438, aspectRatio: undefined},
  reelPreviewCompact: {width: 112, height: 150, aspectRatio: undefined, padding: 10},
  reelVideo: {...StyleSheet.absoluteFillObject},
  reelScrim: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)'},
  reelPreviewInner: {gap: 6, maxWidth: '82%'},
  reelPreviewTitle: {color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '900'},
  reelPreviewTitleCompact: {fontSize: 14, lineHeight: 17},
  reelPreviewMeta: {color: UI.roseSoft, fontSize: 14, fontWeight: '900'},
  previewErrorText: {color: '#FFDCE3', fontSize: 13, fontWeight: '800'},
  readyBadge: {position: 'absolute', top: 14, right: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 12, paddingVertical: 7},
  readyBadgeText: {color: UI.ink, fontSize: 12, fontWeight: '900'},
  outputBox: {borderRadius: 8, backgroundColor: UI.surface, padding: 12, borderWidth: 1, borderColor: UI.line, gap: 4},
  outputLabel: {color: '#6C6A66', fontSize: 12, fontWeight: '900', textTransform: 'uppercase'},
  outputText: {color: UI.ink, fontSize: 13, lineHeight: 18},
  outputHint: {color: '#8A8883', fontSize: 12, lineHeight: 17},
  paywallBackdrop: {flex: 1, backgroundColor: 'rgba(17,17,19,0.58)', justifyContent: 'flex-end'},
  paywallCard: {borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: UI.bg, padding: 18, paddingBottom: 28, gap: 13},
  modifyCard: {borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: UI.bg, padding: 18, paddingBottom: 28, gap: 12},
  modifyTitle: {color: UI.ink, fontSize: 25, lineHeight: 30, fontWeight: '900'},
  modifyInput: {
    minHeight: 132,
    borderRadius: 8,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.line,
    color: UI.ink,
    fontSize: 17,
    lineHeight: 23,
    padding: 13,
    textAlignVertical: 'top',
  },
  modifyQuickRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  modifyChip: {borderRadius: 999, backgroundColor: '#F0F0EC', paddingHorizontal: 12, paddingVertical: 9},
  modifyChipText: {color: UI.ink, fontSize: 13, lineHeight: 16, fontWeight: '900'},
  paywallKicker: {color: UI.ink, fontSize: 12, fontWeight: '900'},
  paywallTitle: {color: UI.ink, fontSize: 28, lineHeight: 32, fontWeight: '900'},
  paywallText: {color: '#3F3E3A', fontSize: 15, lineHeight: 22},
  paywallProductList: {gap: 8},
  paywallProduct: {
    minHeight: 76,
    borderRadius: 8,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.line,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  paywallProductSelected: {borderColor: UI.ink, backgroundColor: '#F0F0EC'},
  paywallProductRadio: {width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: '#C8C7C1', alignItems: 'center', justifyContent: 'center'},
  paywallProductRadioSelected: {borderColor: UI.ink},
  paywallProductRadioDot: {width: 9, height: 9, borderRadius: 5, backgroundColor: UI.ink},
  paywallProductCopy: {flex: 1, gap: 3},
  paywallProductTitle: {color: UI.ink, fontSize: 15, lineHeight: 19, fontWeight: '900'},
  paywallProductMeta: {color: UI.muted, fontSize: 12, lineHeight: 16, fontWeight: '700'},
  paywallProductPrice: {color: UI.ink, fontSize: 15, lineHeight: 19, fontWeight: '900'},
  paywallMiniFeatures: {borderRadius: 8, backgroundColor: UI.surface, padding: 10, borderWidth: 1, borderColor: UI.line, flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  paywallFeature: {flex: 1, alignItems: 'center', gap: 8},
  paywallFeatureIcon: {width: 48, height: 48, borderRadius: 8, backgroundColor: UI.dark, alignItems: 'center', justifyContent: 'center'},
  paywallFeatureText: {color: UI.ink, fontSize: 12, lineHeight: 16, fontWeight: '800', textAlign: 'center'},
  paywallProgress: {borderRadius: 8, backgroundColor: '#F0F0EC', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10},
  paywallProgressText: {color: UI.ink, fontSize: 13, fontWeight: '900'},
  uploadProgressTray: {
    minHeight: 66,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: '#E0DFD8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#D1D0CA',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 7},
  },
  uploadProgressIcon: {width: 44, height: 44, borderRadius: 8, backgroundColor: '#F8F8F5', alignItems: 'center', justifyContent: 'center'},
  uploadProgressCopy: {flex: 1, gap: 8},
  uploadProgressTextRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10},
  uploadProgressTitle: {flex: 1, color: UI.ink, fontSize: 13, lineHeight: 17, fontWeight: '900'},
  uploadProgressCount: {color: UI.muted, fontSize: 12, lineHeight: 16, fontWeight: '800'},
  uploadProgressTrack: {height: 7, borderRadius: 999, backgroundColor: '#E8E7E0', overflow: 'hidden'},
  uploadProgressFill: {height: 7, borderRadius: 999, backgroundColor: UI.rose},
  reelRow: {flexDirection: 'row', gap: 12, borderRadius: 8, backgroundColor: UI.surface, padding: 10, borderWidth: 1, borderColor: UI.line},
  projectHubCard: {borderRadius: 8, backgroundColor: UI.dark, padding: 14, gap: 14},
  projectHubHeader: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12},
  projectHubTitleBlock: {flex: 1, gap: 3},
  projectHubLabel: {color: '#A9A9A4', fontSize: 12, lineHeight: 16, fontWeight: '800'},
  projectHubTitle: {color: '#FFFFFF', fontSize: 23, lineHeight: 28, fontWeight: '900'},
  projectHubStatusPill: {borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, paddingVertical: 6},
  projectHubStatusText: {color: '#FFFFFF', fontSize: 12, lineHeight: 15, fontWeight: '900'},
  projectHubStats: {flexDirection: 'row', gap: 8},
  projectHubStat: {flex: 1, minHeight: 64, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', padding: 9, justifyContent: 'space-between'},
  projectHubStatLabel: {color: '#BDBDB8', fontSize: 11, lineHeight: 14, fontWeight: '800'},
  projectHubInviteCode: {color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontWeight: '900', letterSpacing: 0},
  projectHubStatValue: {color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: '900'},
  projectHubShareButton: {minHeight: 46, borderRadius: 999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center'},
  projectHubShareText: {color: UI.ink, fontSize: 14, lineHeight: 18, fontWeight: '900'},
  myReelCard: {flexDirection: 'row', gap: 12, borderRadius: 8, backgroundColor: UI.surface, padding: 10, borderWidth: 1, borderColor: UI.line, alignItems: 'center'},
  reelThumb: {width: 74, height: 94, borderRadius: 8, backgroundColor: UI.dark, alignItems: 'center', justifyContent: 'center'},
  reelThumbText: {color: '#FFFFFF', fontSize: 13, fontWeight: '900'},
  reelText: {flex: 1, justifyContent: 'center', gap: 4},
  purchaseTopBar: {minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  backButton: {width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center'},
  backButtonText: {color: UI.ink, fontSize: 42, lineHeight: 42, fontWeight: '400', marginTop: -5},
  backButtonSpacer: {width: 42, height: 42},
  purchaseTopTitle: {color: UI.ink, fontSize: 18, lineHeight: 23, fontWeight: '800'},
  purchaseHero: {paddingTop: 18, paddingBottom: 4, gap: 8},
  purchaseTitle: {color: UI.ink, fontSize: 32, lineHeight: 36, fontWeight: '900'},
  purchaseText: {color: UI.muted, fontSize: 15, lineHeight: 21, fontWeight: '600'},
  purchaseStatusRow: {
    minHeight: 56,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#D9D8D2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  purchaseStatusLabel: {color: UI.muted, fontSize: 13, lineHeight: 17, fontWeight: '700'},
  purchaseStatusValue: {color: UI.ink, fontSize: 14, lineHeight: 18, fontWeight: '800'},
  purchaseProductList: {gap: 8, paddingTop: 10},
  purchaseProduct: {
    minHeight: 78,
    borderRadius: 8,
    backgroundColor: UI.surface,
    borderWidth: 1,
    borderColor: UI.line,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  purchaseProductSelected: {borderColor: UI.ink, backgroundColor: '#F0F0EC'},
  purchaseFinePrint: {borderRadius: 8, backgroundColor: UI.surface, padding: 10, borderWidth: 1, borderColor: UI.line, flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  purchaseBottomCta: {paddingTop: 4},
  settingsHeader: {minHeight: 46, justifyContent: 'center'},
  settingsTitle: {color: UI.ink, fontSize: 28, lineHeight: 34, fontWeight: '800'},
  settingsGroup: {paddingTop: 14},
  settingsGroupLabel: {marginBottom: 4, color: UI.muted, fontSize: 12, lineHeight: 16, fontWeight: '700'},
  settingsActionText: {color: UI.ink, fontSize: 14, fontWeight: '700'},
  settingRow: {
    minHeight: 58,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D9D8D2',
  },
  settingTextBlock: {flex: 1, gap: 2},
  settingLabel: {color: UI.ink, fontSize: 16, lineHeight: 21, fontWeight: '700'},
  settingValue: {color: UI.muted, fontSize: 14, lineHeight: 19, fontWeight: '600'},
  settingValueCompact: {fontSize: 13, lineHeight: 18},
  settingsBuyButton: {minHeight: 48, borderRadius: 999, backgroundColor: UI.ink, alignItems: 'center', justifyContent: 'center', marginTop: 12},
  settingsBuyButtonText: {color: '#FFFFFF', fontSize: 15, lineHeight: 19, fontWeight: '900'},
  settingsSwitch: {width: 44, height: 26, borderRadius: 999, backgroundColor: '#D2D2CC', padding: 3},
  settingsSwitchOn: {backgroundColor: UI.ink},
  settingsSwitchKnob: {width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF'},
  settingsSwitchKnobOn: {transform: [{translateX: 18}]},
  clearSessionRow: {minHeight: 54, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#D9D8D2'},
  clearSessionText: {color: UI.roseInk, fontSize: 16, fontWeight: '800'},
  button: {minHeight: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: UI.ink, paddingHorizontal: 16, flexDirection: 'row', gap: 8},
  secondaryButton: {borderWidth: 1, borderColor: '#D2D2CC', backgroundColor: UI.surface},
  secondaryDarkButton: {borderWidth: 1, borderColor: '#3F3F43', backgroundColor: '#1D1D20'},
  buttonDisabled: {opacity: 0.42},
  buttonText: {color: '#FFFFFF', fontSize: 15, fontWeight: '900'},
  secondaryButtonText: {color: UI.ink},
  tabGlyph: {width: 46, height: 40, alignItems: 'center', justifyContent: 'center', opacity: 0.62},
  tabGlyphActive: {opacity: 1},
  iconImage: {flexShrink: 0},
  resultSafe: {flex: 1, backgroundColor: UI.dark},
  resultWordmark: {color: '#FFFFFF', fontSize: 22, fontWeight: '900'},
  resultTitle: {color: '#FFFFFF', fontSize: 30, lineHeight: 33, fontWeight: '900'},
  resultSubtle: {color: '#C9C9C2', fontSize: 15, lineHeight: 21},
});
