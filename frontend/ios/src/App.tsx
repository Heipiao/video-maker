import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutChangeEvent,
  LayoutRectangle,
  NativeModules,
  PanResponder,
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
  API_BASE_URL,
  Asset,
  createAdvisorOptions,
  createRenderJob,
  DemoAsset,
  fetchCatalog,
  fetchDemoAssets,
  generateVideoSpec,
  getRenderJob,
  normalizeLocalExportUrl,
  registerAsset,
  RenderJob,
  saveVideoSpec,
  startConfiguredRender,
  Template,
  uploadFile,
  VideoSpec,
} from './api/client';

type RootTabs = {
  Create: undefined;
  'My Reel': undefined;
  Settings: undefined;
};

type CreateStackParams = {
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

type InterviewAnswer = {
  questionId: string;
  question: string;
  answer: string;
};

type RenderStage = 'idle' | 'story' | 'beats' | 'rendering' | 'ready' | 'failed';

type VowFrameExportModuleType = {
  downloadExport: (url: string) => Promise<LocalExport>;
  saveVideoToPhotos: (url: string) => Promise<LocalExport>;
};

const VowFrameExportModule = NativeModules.VowFrameExportModule as VowFrameExportModuleType | undefined;
const RENDER_POLL_INTERVAL_MS = 3000;
const RENDER_POLL_TIMEOUT_MS = 10 * 60 * 1000;

const Tab = createBottomTabNavigator<RootTabs>();
const Stack = createNativeStackNavigator<CreateStackParams>();

const RECOMMENDED_TAGS = ['first look', 'vows', 'family', 'dance', 'details', 'rings', 'sunset'];
const INTERVIEW_STEPS = [
  {
    id: 'couple',
    question: 'What names should appear in the opening?',
    placeholder: 'Emma and Noah',
    suggestions: ['Emma and Noah', 'Bride and Groom', 'Our wedding day'],
  },
  {
    id: 'style',
    question: 'What should this reel feel like?',
    placeholder: 'Warm, cinematic, emotional, a little modern',
    suggestions: ['Warm and cinematic', 'Modern editorial', 'Family memory'],
  },
  {
    id: 'story',
    question: 'Which moments matter most?',
    placeholder: 'First look, vows, parents, dance floor',
    suggestions: ['First look and vows', 'Family and speeches', 'Party and dance'],
  },
  {
    id: 'pacing',
    question: 'How should the edit move?',
    placeholder: 'Start soft, then cut faster with music',
    suggestions: ['Soft then energetic', 'Slow and romantic', 'Beat synced'],
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
  renderJob: RenderJob | null;
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
  renderJob: null,
};

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchCatalog()
      .then(catalog => setState(current => ({...current, templates: catalog.templates})))
      .catch(error => Alert.alert('Backend unavailable', error.message));
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
            tabBarActiveTintColor: '#D95B49',
            tabBarInactiveTintColor: '#6C6761',
            tabBarStyle: {backgroundColor: '#FFFCF6', borderTopColor: '#E7DED4'},
          }}>
          <Tab.Screen
            name="Create"
            component={CreateNavigator}
            options={({route}) => {
              const routeName = getFocusedRouteNameFromRoute(route) ?? 'PhotoWall';
              return {
                tabBarStyle:
                  routeName === 'PhotoWall'
                    ? {backgroundColor: '#FFFCF6', borderTopColor: '#E7DED4'}
                    : {display: 'none'},
              };
            }}
          />
          <Tab.Screen name="My Reel" component={MyReelScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color="#FFFFFF" />
        </View>
      ) : null}
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
        headerStyle: {backgroundColor: '#FFFCF6'},
        headerTintColor: '#141311',
        contentStyle: {backgroundColor: '#FFFCF6'},
      }}>
      <Stack.Screen name="PhotoWall" component={PhotoWallScreen} options={{headerShown: false}} />
      <Stack.Screen name="Tagging" component={TaggingScreen} options={{title: 'Tag moment'}} />
      <Stack.Screen name="AudioPicker" component={AudioPickerScreen} options={{title: 'Choose music'}} />
      <Stack.Screen name="Interview" component={InterviewScreen} options={{title: 'AI interview'}} />
      <Stack.Screen name="RenderingResult" component={RenderingResultScreen} options={{headerShown: false}} />
    </Stack.Navigator>
  );
}

function PhotoWallScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'PhotoWall'>) {
  const {state, setState, run, busy} = useAppState();
  const [customTag, setCustomTag] = useState('');
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const tags = useMemo(() => {
    const seen = new Set<string>();
    return [...customTags, ...RECOMMENDED_TAGS].filter(tag => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [customTags]);
  const visualAssets = state.localAssets.filter(asset => asset.type === 'photo' || asset.type === 'video');

  function patchAssetTag(assetId: string, tag: string) {
    setState(current => applyTagToState(current, assetId, tag));
    setActiveTag(null);
  }

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
        for (const item of picked) {
          if (!item.uri) {
            continue;
          }
          const upload = await uploadFile({uri: item.uri, type: item.type, fileName: item.fileName});
          const assetType = upload.suggested_asset_type === 'music' ? 'video' : upload.suggested_asset_type;
          const tag = assetType === 'video' ? 'video' : 'wedding';
          const dimensions = assetDimensionsFromUnknown({width: item.width, height: item.height});
          const response = await registerAsset({
            type: assetType,
            url: upload.url,
            tag,
            description: item.fileName || upload.filename,
            metadata: dimensions,
            analysis_status: 'ready',
            analysis: {
              visual: {
                description: item.fileName || upload.filename,
                detected_tags: [tag],
                mood: 'romantic',
              },
            },
          });
          registered.push(response.asset);
          previews.push(localAssetFromAsset(response.asset, item.uri, dimensions));
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
        })),
    );
  }

  async function loadDemoMoments() {
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
        }));
      },
    );
  }

  function continueToAudio() {
    if (!visualAssets.length) {
      Alert.alert('Add moments', 'Add photos or videos before choosing music.');
      return;
    }
    navigation.navigate('AudioPicker');
  }

  function addCustomTag() {
    const nextTag = customTag.trim();
    if (!nextTag) {
      return;
    }
    setCustomTags(current => {
      const duplicateCustomTag = current.some(tag => tag.toLowerCase() === nextTag.toLowerCase());
      const duplicateRecommendedTag = RECOMMENDED_TAGS.some(tag => tag.toLowerCase() === nextTag.toLowerCase());
      if (duplicateCustomTag || duplicateRecommendedTag) {
        return current;
      }
      return [nextTag, ...current];
    });
    setCustomTag('');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.photoWallScreen}>
        <ScrollView contentContainerStyle={styles.wallContent} showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.wordmark}>
                Vow<Text style={styles.wordmarkAccent}>Frame</Text>
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Demo assets"
              style={styles.tinyPill}
              onPress={loadDemoMoments}
              disabled={busy}>
              <Text style={styles.tinyPillText}>Demo assets</Text>
            </Pressable>
          </View>

          <View style={styles.wallHeader}>
            <Text style={styles.wallTitle}>Tag your wedding moments</Text>
            <View style={styles.tagTray}>
              {tags.map(tag => (
                <DraggableTag
                  key={tag}
                  label={tag}
                  active={activeTag === tag}
                  onSelect={() => setActiveTag(current => (current === tag ? null : tag))}
                  onDrop={(moveX, moveY) => patchAssetTagByPoint(moveX, moveY, tag, patchAssetTag)}
                />
              ))}
            </View>
            <Text style={styles.tagHint}>
              {activeTag ? `Tap a photo to add "${activeTag}"` : 'Tap a tag, then tap a photo. You can also drag tags onto photos.'}
            </Text>

            <View style={styles.customTagRow}>
              <TextInput
                style={styles.tagInput}
                value={customTag}
                onChangeText={setCustomTag}
                onSubmitEditing={addCustomTag}
                returnKeyType="done"
                placeholder="Add tag"
                placeholderTextColor="#8D8881"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add tag"
                style={styles.addTagButton}
                onPress={addCustomTag}>
                <Text style={styles.addTagButtonText}>+</Text>
              </Pressable>
            </View>
          </View>

          <PhotoWallGrid
            assets={visualAssets}
            activeTag={activeTag}
            onOpen={asset => navigation.navigate('Tagging', {assetId: asset.id})}
            onApplyTag={patchAssetTag}
            emptyAction={pickMedia}
          />

        </ScrollView>
        <View style={styles.stickyCta}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Upload photo or video"
            style={styles.uploadStrip}
            onPress={pickMedia}
            disabled={busy}>
            <Text style={styles.uploadStripIcon}>PHOTO</Text>
            <Text style={styles.uploadStripText}>{busy ? 'Uploading' : 'Upload photo/video'}</Text>
          </Pressable>
          <Button label="Choose music  >" onPress={continueToAudio} disabled={!visualAssets.length} />
        </View>
      </View>
    </SafeAreaView>
  );
}

let wallDropResolver: ((moveX: number, moveY: number, tag: string, patch: (assetId: string, tag: string) => void) => void) | null = null;

function patchAssetTagByPoint(moveX: number, moveY: number, tag: string, patch: (assetId: string, tag: string) => void) {
  wallDropResolver?.(moveX, moveY, tag, patch);
}

function TaggingScreen({navigation, route}: NativeStackScreenProps<CreateStackParams, 'Tagging'>) {
  const {state, setState} = useAppState();
  const asset = state.localAssets.find(item => item.id === route.params.assetId);
  const [caption, setCaption] = useState(asset?.caption || asset?.description || '');
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

  function applyTag(tag: string) {
    setState(current => applyTagToState(current, assetId, tag));
  }

  function saveCaption() {
    setState(current => ({
      ...current,
      localAssets: current.localAssets.map(item => (item.id === assetId ? {...item, caption} : item)),
      assets: current.assets.map(item => (item.id === assetId ? {...item, caption} : item)),
    }));
    navigation.goBack();
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
        {[...asset.tags, ...RECOMMENDED_TAGS].slice(0, 12).map(tag => (
          <TagChip key={tag} label={tag} selected={asset.tags.includes(tag)} onPress={() => applyTag(tag)} />
        ))}
      </View>
      <View style={styles.customTagRow}>
        <TextInput
          style={styles.tagInput}
          value={customTag}
          onChangeText={setCustomTag}
          placeholder="Custom tag"
          placeholderTextColor="#8D8881"
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
      <Field label="Caption" value={caption} onChangeText={setCaption} placeholder="Tell me about this moment" />
      <Button label="Save moment" onPress={saveCaption} />
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
          });
          const response = await registerAsset({
            type: 'music',
            url: upload.url,
            tag: 'custom audio',
            description: file.name || upload.filename,
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
            assets: [...current.assets, asset],
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

  return (
    <Screen>
      <View style={styles.audioHeroCard}>
        <Text style={styles.audioHeroLabel}>Soundtrack</Text>
        <Text style={styles.title}>Choose music</Text>
        <Text style={styles.subtle}>Preview tracks here, pick one, then tune beat sync for the final reel.</Text>
        <View style={styles.nowPlayingRow}>
          <View style={styles.nowPlayingBars}>
            {[18, 30, 22, 38, 26, 34].map((height, index) => (
              <View
                key={`${height}-${index}`}
                style={[styles.nowPlayingBar, {height}, playingUrl && styles.nowPlayingBarActive]}
              />
            ))}
          </View>
          <View style={styles.nowPlayingText}>
            <Text style={styles.metaText}>{playingUrl ? 'Now playing' : 'Preview in app'}</Text>
            <Text style={styles.nowPlayingTitle} numberOfLines={1}>
              {playingTitle || selectedMusic?.description || selectedMusic?.tag || 'No track selected'}
            </Text>
          </View>
        </View>
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

      <View style={styles.beatSyncRow}>
        <View style={styles.beatSyncText}>
          <Text style={styles.cardTitle}>Beat sync</Text>
          <Text style={styles.bodyText}>Let the edit land around stronger music moments.</Text>
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Beat sync"
          style={[styles.switch, state.beatSyncEnabled && styles.switchOn]}
          onPress={() => setState(current => ({...current, beatSyncEnabled: !current.beatSyncEnabled}))}>
          <View style={[styles.switchKnob, state.beatSyncEnabled && styles.switchKnobOn]} />
        </Pressable>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Upload your own audio" style={styles.uploadAudioCard} onPress={uploadAudio}>
        <View>
          <Text style={styles.cardTitle}>Upload your own audio</Text>
          <Text style={styles.bodyText}>MP3, M4A, WAV, AAC, or any iOS-supported file.</Text>
        </View>
        <Text style={styles.plusMark}>+</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Built-in tracks</Text>
      {demoMusic.map(track => {
        const selected = Boolean(selectedMusic && selectedMusic.url.endsWith(track.url));
        const title = track.title || track.tag;
        const previewUrl = normalizeLocalExportUrl(track.url) || track.url;
        const isPlaying = playingUrl === previewUrl;
        return (
          <AudioCard
            key={track.id}
            title={title}
            subtitle={track.description || track.tag}
            tag={track.tag}
            selected={selected}
            isPlaying={isPlaying}
            onPreview={() => togglePreview({url: track.url, title})}
            onPress={() => selectBuiltIn(track)}
          />
        );
      })}

      {selectedMusic ? (
        <View style={styles.selectedMusicBar}>
          <Text style={styles.selectedMusicText}>Selected: {selectedMusic.description || selectedMusic.tag}</Text>
        </View>
      ) : null}
      <Button label={busy ? 'Preparing' : 'Start AI Interview'} onPress={continueToInterview} disabled={busy} />
    </Screen>
  );
}

function InterviewScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'Interview'>) {
  const {state, setState} = useAppState();
  const [stepIndex, setStepIndex] = useState(Math.min(state.interviewAnswers.length, INTERVIEW_STEPS.length - 1));
  const currentStep = INTERVIEW_STEPS[stepIndex];
  const existingAnswer = state.interviewAnswers.find(answer => answer.questionId === currentStep.id)?.answer || '';
  const [answer, setAnswer] = useState(existingAnswer);

  useEffect(() => {
    const nextStep = INTERVIEW_STEPS[stepIndex];
    setAnswer(state.interviewAnswers.find(item => item.questionId === nextStep.id)?.answer || '');
  }, [stepIndex, state.interviewAnswers]);

  function saveAnswer(value: string) {
    const trimmed = value.trim();
    if (!trimmed) {
      Alert.alert('Answer needed', 'Add a short answer so the advisor can shape the reel.');
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
          <Text style={styles.avatarText}>VF</Text>
        </View>
        <View style={styles.interviewIntro}>
          <Text style={styles.cardTitle}>Wedding consultant</Text>
          <Text style={styles.bodyText}>Question {stepIndex + 1} of {INTERVIEW_STEPS.length}</Text>
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
          placeholderTextColor="#8D8881"
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
      <Button label={stepIndex === INTERVIEW_STEPS.length - 1 ? 'Generate reel' : 'Next question'} onPress={() => saveAnswer(answer)} />
    </Screen>
  );
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

async function waitForReadyJob(job: RenderJob) {
  const deadline = Date.now() + RENDER_POLL_TIMEOUT_MS;
  let latest = job;
  while (latest.status !== 'ready') {
    if (['failed', 'preempted', 'expired'].includes(latest.status)) {
      throw new Error(latest.error || `Render job ${latest.status}`);
    }
    if (Date.now() >= deadline) {
      throw new Error('Render timed out before the MP4 was ready.');
    }
    await sleep(RENDER_POLL_INTERVAL_MS);
    latest = (await getRenderJob(job.id)).job;
  }
  return latest;
}

function RenderingResultScreen({navigation}: NativeStackScreenProps<CreateStackParams, 'RenderingResult'>) {
  const {state, setState} = useAppState();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const outputUrl = normalizeLocalExportUrl(state.renderJob?.output_url);
  const isReady = state.renderStage === 'ready' && Boolean(outputUrl);

  useEffect(() => {
    if (startedRef.current || state.renderStage === 'ready') {
      return;
    }
    startedRef.current = true;
    createVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createVideo() {
    try {
      setError(null);
      setState(current => ({...current, renderStage: 'story'}));
      const options = await createAdvisorOptions({
        couple_names: state.details.coupleNames || 'Our Wedding',
        wedding_date: state.details.weddingDate,
        location: state.details.location,
        asset_ids: state.assets.map(asset => asset.id),
      });
      const option = options.options[0];
      if (!option) {
        throw new Error('Advisor did not return an edit direction.');
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
      });

      setState(current => ({...current, renderStage: 'rendering'}));
      const updatedSpec = patchSpecForInterview(generated.spec, option, state);
      const saved = await saveVideoSpec(updatedSpec);
      const manifestJob = await createRenderJob(saved.spec.id);
      const started = await startConfiguredRender(manifestJob.job.id);
      const readyJob = started.job.status === 'ready' ? started.job : await waitForReadyJob(started.job);
      setState(current => ({
        ...current,
        spec: saved.spec,
        renderJob: readyJob,
        renderStage: 'ready',
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to render video.';
      setError(message);
      setState(current => ({...current, renderStage: 'failed'}));
    }
  }

  function retry() {
    startedRef.current = false;
    createVideo();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.resultContent}>
        <View style={styles.topBar}>
          <Text style={styles.wordmark}>VowFrame</Text>
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
            <Text style={styles.title}>Rendering</Text>
            <Text style={styles.subtle}>Your AI interview, tags, and music are becoming a vertical MP4.</Text>
            <StageRow label="Writing story" active={state.renderStage === 'story'} done={['beats', 'rendering', 'ready'].includes(state.renderStage)} />
            <StageRow label="Matching beats" active={state.renderStage === 'beats'} done={['rendering', 'ready'].includes(state.renderStage)} />
            <StageRow label="Rendering MP4" active={state.renderStage === 'rendering'} done={state.renderStage === 'ready'} />
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
  const outputUrl = normalizeLocalExportUrl(state.renderJob?.output_url);

  function resetFlow() {
    setState(current => ({...initialState, templates: current.templates}));
    navigation.popToTop();
  }

  async function withExportUrl(action: string, task: (exportUrl: string) => Promise<void>) {
    if (!outputUrl) {
      Alert.alert('Export unavailable', 'The MP4 export is not ready yet.');
      return;
    }
    try {
      setExportAction(action);
      await task(outputUrl);
    } catch (caught) {
      Alert.alert('Export failed', caught instanceof Error ? caught.message : 'Unable to complete export action.');
    } finally {
      setExportAction(null);
    }
  }

  function saveToPhotos() {
    withExportUrl('save', async exportUrl => {
      if (!VowFrameExportModule) {
        throw new Error('The native export module is not available in this build.');
      }
      await VowFrameExportModule.saveVideoToPhotos(exportUrl);
      Alert.alert('Saved to Photos', 'Your wedding reel was saved to your photo library.');
    });
  }

  function shareExport() {
    withExportUrl('share', async exportUrl => {
      if (VowFrameExportModule) {
        const localExport = await VowFrameExportModule.downloadExport(exportUrl);
        await Share.share({title: 'VowFrame wedding reel', message: 'My VowFrame wedding reel is ready.', url: localExport.fileUri});
        return;
      }
      await Share.share({title: 'VowFrame wedding reel', message: exportUrl});
    });
  }

  return (
    <View style={styles.resultPanel}>
      <Text style={styles.title}>Ready to share</Text>
      <Text style={styles.subtle}>The backend rendered your Remotion MP4.</Text>
      <VideoPreviewCard
        outputUrl={outputUrl}
        title={state.spec?.title || 'Wedding reel'}
        meta="9:16 MP4 preview"
        size="large"
        onError={() => setPreviewError('Preview failed. The MP4 URL is still available below.')}
      />
      {previewError ? <Text style={styles.previewErrorText}>{previewError}</Text> : null}
      <View style={styles.outputBox}>
        <Text style={styles.outputLabel}>Output URL</Text>
        <Text style={styles.outputText}>{outputUrl}</Text>
      </View>
      <Button label={exportAction === 'save' ? 'Saving' : 'Save to Photos'} onPress={saveToPhotos} disabled={Boolean(exportAction)} />
      <Button label={exportAction === 'share' ? 'Preparing' : 'Share'} variant="secondary" onPress={shareExport} disabled={Boolean(exportAction)} />
      <Button label="Create another version" variant="secondary" onPress={resetFlow} />
    </View>
  );
}

function MyReelScreen() {
  const {state} = useAppState();
  const outputUrl = normalizeLocalExportUrl(state.renderJob?.output_url);

  return (
    <Screen>
      <Text style={styles.title}>My Reel</Text>
      {state.renderJob ? (
        <View style={styles.myReelCard}>
          {outputUrl ? (
            <VideoPreviewCard
              outputUrl={outputUrl}
              title={state.spec?.title || state.details.coupleNames || 'Wedding reel'}
              meta="Tap to preview"
              size="compact"
            />
          ) : (
            <View style={styles.reelThumb}>
              <Text style={styles.reelThumbText}>MP4</Text>
            </View>
          )}
          <View style={styles.reelText}>
            <Text style={styles.cardTitle}>{state.spec?.title || state.details.coupleNames || 'Wedding reel'}</Text>
            <Text style={styles.bodyText}>{state.renderJob.status} - {outputUrl || 'No output yet'}</Text>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No reel yet</Text>
          <Text style={styles.bodyText}>Create your first wedding reel from the Create tab.</Text>
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
    <View style={[styles.reelPreview, size === 'compact' && styles.reelPreviewCompact]}>
      {outputUrl ? (
        <Video
          source={{uri: outputUrl}}
          style={styles.reelVideo}
          resizeMode="cover"
          controls
          paused
          onError={onError}
        />
      ) : null}
      <View pointerEvents="none" style={styles.reelScrim} />
      <View style={styles.reelPreviewInner} pointerEvents="none">
        <Text style={[styles.reelPreviewTitle, size === 'compact' && styles.reelPreviewTitleCompact]}>{title}</Text>
        <Text style={styles.reelPreviewMeta}>{meta}</Text>
      </View>
      <View pointerEvents="none" style={styles.readyBadge}>
        <Text style={styles.readyBadgeText}>Ready</Text>
      </View>
    </View>
  );
}

function SettingsScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Settings</Text>
      {[
        `Backend: ${API_BASE_URL}`,
        'Music license notice',
        'Privacy Policy',
        'Terms',
        'Support',
        'Delete data',
        'Version 0.1.0',
      ].map(item => (
        <Pressable key={item} style={styles.settingRow} onPress={() => Alert.alert(item)}>
          <Text style={styles.settingText}>{item}</Text>
        </Pressable>
      ))}
    </Screen>
  );
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
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#8D8881" />
    </View>
  );
}

function PhotoWallGrid({
  assets,
  activeTag,
  onOpen,
  onApplyTag,
  emptyAction,
}: {
  assets: LocalAsset[];
  activeTag: string | null;
  onOpen: (asset: LocalAsset) => void;
  onApplyTag: (assetId: string, tag: string) => void;
  emptyAction: () => void;
}) {
  const wallRef = useRef<View>(null);
  const [cardLayouts, setCardLayouts] = useState<Record<string, LayoutRectangle>>({});
  const tiles: LocalAsset[] = assets.length
    ? assets
    : Array.from({length: 5}, (_, index) => ({id: `empty-${index}`, uri: '', type: 'photo', tag: 'moment', tags: ['moment']}));

  useEffect(() => {
    const resolver = (moveX: number, moveY: number, tag: string, patch: (assetId: string, tag: string) => void) => {
      wallRef.current?.measureInWindow((x, y, width, height) => {
        const localX = moveX - x;
        const localY = moveY - y;
        if (localX < 0 || localY < 0 || localX > width || localY > height) {
          return;
        }
        const target = nearestAssetAtPoint(assets, cardLayouts, localX, localY);
        if (target) {
          patch(target.id, tag);
        }
      });
    };
    wallDropResolver = resolver;
    return () => {
      if (wallDropResolver === resolver) {
        wallDropResolver = null;
      }
    };
  }, [assets, cardLayouts]);

  function onTileLayout(assetId: string, event: LayoutChangeEvent) {
    const layout = event?.nativeEvent?.layout;
    if (!layout) {
      return;
    }
    setCardLayouts(current => ({...current, [assetId]: layout}));
  }

  return (
    <View ref={wallRef} style={styles.wall}>
      {tiles.map((asset, index) => {
        const hasMedia = Boolean(asset.uri);
        const tileStyle = [styles.tile, tileStyleForAsset(asset, hasMedia, index)];
        return (
          <Pressable
            key={asset.id}
            accessibilityRole="button"
            style={tileStyle}
            onPress={() => {
              if (hasMedia && activeTag) {
                onApplyTag(asset.id, activeTag);
                return;
              }
              if (hasMedia) {
                onOpen(asset);
                return;
              }
              emptyAction();
            }}
            onLayout={event => onTileLayout(asset.id, event)}>
            {hasMedia ? (
              <MomentVisual asset={asset} />
            ) : (
              <View style={styles.emptyTile}>
                <Text style={styles.emptyLabel}>Add moment</Text>
              </View>
            )}
            {asset.type === 'video' && hasMedia ? (
              <View style={styles.videoBadge}>
                <Text style={styles.videoBadgeText}>PLAY</Text>
              </View>
            ) : null}
            {hasMedia ? (
              <View style={styles.photoNote}>
                <Text style={styles.photoNoteText}>{asset.tag}</Text>
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

function DraggableTag({
  label,
  active,
  onSelect,
  onDrop,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  onDrop: (moveX: number, moveY: number) => void;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const hasMoved = useRef(false);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10,
        onPanResponderGrant: () => {
          hasMoved.current = false;
          pan.stopAnimation();
          pan.setValue({x: 0, y: 0});
        },
        onPanResponderMove: (_event, gesture) => {
          if (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6) {
            hasMoved.current = true;
          }
          pan.setValue({x: gesture.dx, y: gesture.dy});
        },
        onPanResponderRelease: (_event, gesture) => {
          if (hasMoved.current) {
            onDrop(gesture.moveX, gesture.moveY);
          } else {
            onSelect();
          }
          Animated.spring(pan, {toValue: {x: 0, y: 0}, useNativeDriver: true}).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, {toValue: {x: 0, y: 0}, useNativeDriver: true}).start();
        },
      }),
    [onDrop, onSelect, pan],
  );

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Drag tag ${label}`}
      onPress={onSelect}>
      <Animated.View
        style={[styles.draggableTag, active && styles.draggableTagActive, {transform: pan.getTranslateTransform()}]}
        {...responder.panHandlers}>
        <Text style={[styles.draggableTagText, active && styles.draggableTagTextActive]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

function TagChip({label, selected, onPress}: {label: string; selected?: boolean; onPress: () => void}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={[styles.tagChip, selected && styles.tagChipSelected]} onPress={onPress}>
      <Text style={[styles.tagChipText, selected && styles.tagChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function AudioCard({
  title,
  subtitle,
  tag,
  selected,
  isPlaying,
  onPreview,
  onPress,
}: {
  title: string;
  subtitle: string;
  tag: string;
  selected: boolean;
  isPlaying: boolean;
  onPreview: () => void;
  onPress: () => void;
}) {
  const bars = [18, 32, 24, 44, 30, 52, 26, 40, 20, 34, 48, 22];
  return (
    <View style={[styles.audioCard, selected && styles.audioCardSelected]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Select music ${title}`}
        style={styles.audioSelectArea}
        onPress={onPress}>
        <View style={styles.waveform}>
          {bars.map((height, index) => (
            <View key={`${height}-${index}`} style={[styles.waveBar, {height}]} />
          ))}
        </View>
        <View style={styles.audioText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.metaText}>{tag}</Text>
          <Text style={styles.audioSubtitle} numberOfLines={2}>{subtitle}</Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${isPlaying ? 'Pause' : 'Preview'} music ${title}`}
        style={[styles.previewButton, isPlaying && styles.previewButtonPlaying]}
        onPress={onPreview}>
        <Text style={[styles.previewButtonText, isPlaying && styles.previewButtonTextPlaying]}>
          {isPlaying ? 'Pause' : 'Play'}
        </Text>
      </Pressable>
    </View>
  );
}

function StageRow({label, active, done}: {label: string; active: boolean; done: boolean}) {
  return (
    <View style={styles.stageRow}>
      <View style={[styles.stageDot, done && styles.stageDotDone, active && styles.stageDotActive]}>
        {active ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
      </View>
      <Text style={[styles.stageLabel, (active || done) && styles.stageLabelActive]}>{label}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.secondaryButton,
        disabled && styles.buttonDisabled,
      ]}>
      <Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryButtonText]}>
        {label}
      </Text>
    </Pressable>
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

function applyTagToState(state: AppState, assetId: string, tag: string): AppState {
  return {
    ...state,
    localAssets: state.localAssets.map(asset =>
      asset.id === assetId
        ? {...asset, tag, tags: Array.from(new Set([tag, ...asset.tags]))}
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
        tag,
        analysis: {
          ...(asset.analysis || {}),
          visual: {
            ...visual,
            detected_tags: Array.from(new Set([tag, ...oldTags])),
          },
        },
      };
    }),
  };
}

function nearestAssetAtPoint(
  assets: LocalAsset[],
  layouts: Record<string, LayoutRectangle>,
  localX: number,
  localY: number,
) {
  let target: LocalAsset | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const asset of assets) {
    const layout = layouts[asset.id];
    if (!layout) {
      continue;
    }
    const inside = localX >= layout.x && localX <= layout.x + layout.width && localY >= layout.y && localY <= layout.y + layout.height;
    const centerX = layout.x + layout.width / 2;
    const centerY = layout.y + layout.height / 2;
    const distance = Math.hypot(localX - centerX, localY - centerY);
    if (inside || distance < bestDistance) {
      target = asset;
      bestDistance = inside ? 0 : distance;
    }
  }
  return target;
}

function detailsFromAnswers(answers: InterviewAnswer[]): WeddingDetails {
  const byId = Object.fromEntries(answers.map(answer => [answer.questionId, answer.answer]));
  return {
    coupleNames: byId.couple || 'Our Wedding',
    weddingDate: '',
    location: byId.story || '',
  };
}

function patchSpecForInterview(spec: VideoSpec, option: AdvisorOption, appState: AppState): VideoSpec {
  const localById = new Map(appState.localAssets.map(asset => [asset.id, asset]));
  const answers = Object.fromEntries(appState.interviewAnswers.map(answer => [answer.questionId, answer.answer]));
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
      primary_color: option.primary_color,
      photo_motion: option.photo_motion,
      transition: option.transition,
      music_volume: option.music_volume,
    },
    timeline: spec.timeline.map(scene => {
      if (scene.type === 'title') {
        return {
          ...scene,
          text: appState.details.coupleNames || answers.couple || scene.text,
          caption: answers.style || scene.caption,
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
        };
      }
      return scene;
    }),
  };
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#FFFCF6'},
  content: {padding: 18, paddingBottom: 118, gap: 16},
  photoWallScreen: {flex: 1, backgroundColor: '#FFFCF6'},
  wallContent: {padding: 14, paddingBottom: 124, gap: 11},
  resultContent: {padding: 18, paddingBottom: 60, gap: 18},
  topBar: {minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  wordmark: {color: '#141311', fontSize: 22, fontWeight: '900'},
  wordmarkAccent: {color: '#D95B49'},
  screenKicker: {color: '#716B64', fontSize: 13, fontWeight: '700', marginTop: 2},
  tinyPill: {borderRadius: 999, backgroundColor: '#E6EED8', paddingHorizontal: 12, paddingVertical: 8},
  tinyPillText: {color: '#28331F', fontSize: 12, fontWeight: '900'},
  heroPanel: {gap: 10, paddingBottom: 4},
  wallHeader: {gap: 10},
  wallTitle: {color: '#141311', fontSize: 28, lineHeight: 31, fontWeight: '900', maxWidth: 310},
  title: {color: '#141311', fontSize: 31, lineHeight: 35, fontWeight: '900'},
  titleSmall: {color: '#141311', fontSize: 24, lineHeight: 29, fontWeight: '900'},
  subtle: {color: '#645F58', fontSize: 15, lineHeight: 21},
  inlineActions: {flexDirection: 'row', gap: 10, marginTop: 4},
  sectionLabel: {color: '#141311', fontSize: 13, fontWeight: '900', textTransform: 'uppercase'},
  customTagRow: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  tagInput: {flex: 1, minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: '#E2D9CF', backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: '#141311', fontSize: 15},
  addTagButton: {width: 46, height: 46, borderRadius: 8, backgroundColor: '#141311', alignItems: 'center', justifyContent: 'center'},
  addTagButtonText: {color: '#FFFFFF', fontSize: 25, lineHeight: 28, fontWeight: '900'},
  tagTray: {minHeight: 38, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center'},
  draggableTag: {zIndex: 20, borderRadius: 999, backgroundColor: '#DDE9C9', paddingHorizontal: 12, paddingVertical: 7, shadowColor: '#7D8D63', shadowOpacity: 0.16, shadowRadius: 9, shadowOffset: {width: 0, height: 5}},
  draggableTagActive: {backgroundColor: '#D95B49', shadowColor: '#D95B49', shadowOpacity: 0.28},
  draggableTagText: {color: '#26331F', fontSize: 13, fontWeight: '900'},
  draggableTagTextActive: {color: '#FFFFFF'},
  tagHint: {color: '#716B64', fontSize: 12, lineHeight: 16, fontWeight: '700'},
  wall: {flexDirection: 'row', flexWrap: 'wrap', gap: 7, alignItems: 'flex-start'},
  tile: {width: '31.8%', height: 108, borderRadius: 8, overflow: 'hidden', backgroundColor: '#E2DDD4'},
  tileHero: {width: '65.5%', height: 196},
  tileFeature: {width: '48.8%', height: 218},
  tileLandscape: {width: '65.5%', height: 118},
  tilePortrait: {width: '48.8%', height: 218},
  tileSquare: {width: '31.8%', height: 112},
  tileShort: {height: 82},
  tileWide: {width: '65.5%', height: 118},
  tileTall: {height: 136},
  tileImage: {width: '100%', height: '100%', resizeMode: 'cover'},
  emptyTile: {flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D4CCC1', borderStyle: 'dashed', backgroundColor: '#F4EFE7'},
  emptyLabel: {color: '#716B64', fontSize: 12, fontWeight: '900'},
  videoTile: {flex: 1, backgroundColor: '#181614', justifyContent: 'flex-end', padding: 10},
  videoLine: {position: 'absolute', top: 16, left: 10, right: 10, height: 3, borderRadius: 2, backgroundColor: '#D95B49'},
  videoTileText: {color: '#FFFFFF', fontSize: 13, fontWeight: '900'},
  videoBadge: {position: 'absolute', top: 8, right: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.88)', paddingHorizontal: 8, paddingVertical: 5},
  videoBadgeText: {color: '#141311', fontSize: 10, fontWeight: '900'},
  photoNote: {position: 'absolute', left: 7, bottom: 7, borderRadius: 999, backgroundColor: '#E6EED8', paddingHorizontal: 8, paddingVertical: 5},
  photoNoteLarge: {position: 'absolute', left: 14, bottom: 14, borderRadius: 999, backgroundColor: '#E6EED8', paddingHorizontal: 12, paddingVertical: 7},
  photoNoteText: {color: '#28331F', fontSize: 11, fontWeight: '900'},
  bottomCta: {paddingTop: 4},
  uploadStrip: {minHeight: 58, borderRadius: 8, borderWidth: 1, borderColor: '#D4CCC1', borderStyle: 'dashed', backgroundColor: '#FFFDF9', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10},
  uploadStripIcon: {color: '#D95B49', fontSize: 11, fontWeight: '900'},
  uploadStripText: {color: '#141311', fontSize: 14, fontWeight: '900'},
  stickyCta: {position: 'absolute', left: 14, right: 14, bottom: 12, gap: 8, paddingTop: 8, backgroundColor: 'rgba(255,252,246,0.96)', shadowColor: '#E6C7BC', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: {width: 0, height: -8}},
  detailPreview: {height: 420, borderRadius: 8, overflow: 'hidden', backgroundColor: '#181614'},
  tagCloud: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  tagChip: {borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2D9CF', paddingHorizontal: 12, paddingVertical: 9},
  tagChipSelected: {backgroundColor: '#DDE9C9', borderColor: '#B7C59E'},
  tagChipText: {color: '#3D3934', fontSize: 13, fontWeight: '800'},
  tagChipTextSelected: {color: '#25331D'},
  field: {gap: 8},
  label: {color: '#141311', fontSize: 14, fontWeight: '900'},
  input: {minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: '#E2D9CF', backgroundColor: '#FFFFFF', paddingHorizontal: 12, color: '#141311', fontSize: 15},
  smallButton: {height: 46, borderRadius: 8, backgroundColor: '#141311', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16},
  smallButtonText: {color: '#FFFFFF', fontSize: 13, fontWeight: '900'},
  beatSyncRow: {borderRadius: 8, backgroundColor: '#FFFFFF', padding: 14, borderWidth: 1, borderColor: '#E7DED4', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14},
  beatSyncText: {flex: 1, paddingRight: 8},
  switch: {width: 54, height: 30, borderRadius: 999, backgroundColor: '#D7D0C6', padding: 3},
  switchOn: {backgroundColor: '#D95B49'},
  switchKnob: {width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF'},
  switchKnobOn: {transform: [{translateX: 24}]},
  audioHeroCard: {borderRadius: 8, backgroundColor: '#FFFFFF', padding: 15, gap: 12, borderWidth: 1, borderColor: '#E7DED4'},
  audioHeroLabel: {color: '#D95B49', fontSize: 12, fontWeight: '900', textTransform: 'uppercase'},
  nowPlayingRow: {minHeight: 76, borderRadius: 8, backgroundColor: '#141311', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12},
  nowPlayingBars: {width: 72, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  nowPlayingBar: {width: 6, borderRadius: 4, backgroundColor: '#6D645D'},
  nowPlayingBarActive: {backgroundColor: '#D95B49'},
  nowPlayingText: {flex: 1, gap: 3},
  nowPlayingTitle: {color: '#FFFFFF', fontSize: 17, fontWeight: '900'},
  audioPlayer: {width: 1, height: 1, opacity: 0},
  uploadAudioCard: {borderRadius: 8, backgroundColor: '#F6E8C8', borderWidth: 1, borderColor: '#E8D6AA', padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14},
  plusMark: {color: '#141311', fontSize: 28, fontWeight: '900'},
  audioCard: {borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7DED4', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12},
  audioCardSelected: {borderColor: '#D95B49', backgroundColor: '#FFF3EF'},
  audioSelectArea: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12},
  waveform: {width: 78, height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  waveBar: {width: 4, borderRadius: 3, backgroundColor: '#C8B6E7'},
  audioText: {flex: 1, gap: 3},
  audioSubtitle: {color: '#645F58', fontSize: 12, lineHeight: 16, fontWeight: '700'},
  previewButton: {borderRadius: 999, backgroundColor: '#141311', paddingHorizontal: 11, paddingVertical: 8},
  previewButtonPlaying: {backgroundColor: '#F6E8C8'},
  previewButtonText: {color: '#FFFFFF', fontSize: 12, fontWeight: '900'},
  previewButtonTextPlaying: {color: '#473A1D'},
  selectedMusicBar: {borderRadius: 8, padding: 12, backgroundColor: '#E6EED8'},
  selectedMusicText: {color: '#28331F', fontSize: 13, fontWeight: '900'},
  card: {borderRadius: 8, backgroundColor: '#FFFFFF', padding: 14, gap: 10, borderWidth: 1, borderColor: '#E7DED4'},
  cardTitle: {color: '#141311', fontSize: 17, fontWeight: '900'},
  bodyText: {color: '#403C37', fontSize: 14, lineHeight: 20},
  metaText: {color: '#A04A3E', fontSize: 13, fontWeight: '900'},
  interviewHeader: {flexDirection: 'row', alignItems: 'center', gap: 12},
  avatar: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#D95B49', alignItems: 'center', justifyContent: 'center'},
  avatarText: {color: '#FFFFFF', fontSize: 14, fontWeight: '900'},
  interviewIntro: {flex: 1},
  progressDots: {flexDirection: 'row', gap: 8},
  progressDot: {height: 7, flex: 1, borderRadius: 7, backgroundColor: '#E2D9CF'},
  progressDotActive: {backgroundColor: '#D95B49'},
  questionBubble: {alignSelf: 'flex-start', maxWidth: '86%', borderRadius: 8, backgroundColor: '#E6EED8', padding: 14},
  questionText: {color: '#202719', fontSize: 20, lineHeight: 25, fontWeight: '900'},
  answerBubble: {borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2D9CF', padding: 12},
  answerInput: {minHeight: 110, color: '#141311', fontSize: 17, lineHeight: 23, textAlignVertical: 'top'},
  quickReplies: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  quickReply: {borderRadius: 999, backgroundColor: '#F6E8C8', paddingHorizontal: 12, paddingVertical: 9},
  quickReplyText: {color: '#473A1D', fontSize: 13, fontWeight: '900'},
  renderPanel: {gap: 18, minHeight: 620, justifyContent: 'center'},
  stageRow: {borderRadius: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7DED4', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12},
  stageDot: {width: 28, height: 28, borderRadius: 14, backgroundColor: '#D7D0C6', alignItems: 'center', justifyContent: 'center'},
  stageDotActive: {backgroundColor: '#D95B49'},
  stageDotDone: {backgroundColor: '#7B8E5E'},
  stageLabel: {color: '#6C6761', fontSize: 15, fontWeight: '800'},
  stageLabelActive: {color: '#141311'},
  errorBox: {gap: 12, borderRadius: 8, backgroundColor: '#FFF3EF', padding: 14, borderWidth: 1, borderColor: '#E7B3A8'},
  errorText: {color: '#9A392C', fontSize: 14, lineHeight: 20, fontWeight: '800'},
  resultPanel: {gap: 16},
  reelPreview: {aspectRatio: 9 / 16, borderRadius: 8, backgroundColor: '#171513', overflow: 'hidden', justifyContent: 'flex-end', padding: 18},
  reelPreviewCompact: {width: 112, height: 150, aspectRatio: undefined, padding: 10},
  reelVideo: {...StyleSheet.absoluteFillObject},
  reelScrim: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)'},
  reelPreviewInner: {gap: 6, maxWidth: '82%'},
  reelPreviewTitle: {color: '#FFFFFF', fontSize: 30, lineHeight: 34, fontWeight: '900'},
  reelPreviewTitleCompact: {fontSize: 14, lineHeight: 17},
  reelPreviewMeta: {color: '#F5D7C3', fontSize: 14, fontWeight: '900'},
  previewErrorText: {color: '#9A392C', fontSize: 13, fontWeight: '800'},
  readyBadge: {position: 'absolute', top: 14, right: 14, borderRadius: 999, backgroundColor: '#E6EED8', paddingHorizontal: 12, paddingVertical: 7},
  readyBadgeText: {color: '#28331F', fontSize: 12, fontWeight: '900'},
  outputBox: {borderRadius: 8, backgroundColor: '#FFFFFF', padding: 12, borderWidth: 1, borderColor: '#E7DED4', gap: 4},
  outputLabel: {color: '#6C6761', fontSize: 12, fontWeight: '900', textTransform: 'uppercase'},
  outputText: {color: '#141311', fontSize: 13, lineHeight: 18},
  reelRow: {flexDirection: 'row', gap: 12, borderRadius: 8, backgroundColor: '#FFFFFF', padding: 10, borderWidth: 1, borderColor: '#E7DED4'},
  myReelCard: {flexDirection: 'row', gap: 12, borderRadius: 8, backgroundColor: '#FFFFFF', padding: 10, borderWidth: 1, borderColor: '#E7DED4', alignItems: 'center'},
  reelThumb: {width: 74, height: 94, borderRadius: 8, backgroundColor: '#171513', alignItems: 'center', justifyContent: 'center'},
  reelThumbText: {color: '#FFFFFF', fontSize: 13, fontWeight: '900'},
  reelText: {flex: 1, justifyContent: 'center', gap: 4},
  settingRow: {minHeight: 52, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#E7DED4'},
  settingText: {color: '#141311', fontSize: 16, fontWeight: '800'},
  button: {minHeight: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D95B49', paddingHorizontal: 16},
  secondaryButton: {borderWidth: 1, borderColor: '#D7CEC3', backgroundColor: '#FFFFFF'},
  buttonDisabled: {opacity: 0.42},
  buttonText: {color: '#FFFFFF', fontSize: 15, fontWeight: '900'},
  secondaryButtonText: {color: '#141311'},
  busy: {position: 'absolute', top: 18, right: 18, borderRadius: 8, backgroundColor: '#141311', padding: 10},
});
