import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { generateDictation, generatePunctuationPractice, generateSpellingPractice, ogeSourceTexts, egeSourceTexts, officialSources, tracks, totalLessons } from './curriculum'
import { buildIndependentChoices, independentExamBank } from './examBank'
import './App.css'
import './readability.css'

type View = 'home' | 'lessons' | 'practice' | 'exams' | 'progress' | 'settings'
type PracticeMode = 'dictation' | 'spelling' | 'punctuation'
type MistakeRecord = { id: string; track: 'base' | 'oge' | 'ege'; unit: string; title: string; question: string; wrongAnswer: string; correctAnswer: string; rationale: string; attempts: number; lastAt: number }
type ExamHistoryRecord = { id: string; track: 'base' | 'oge' | 'ege'; kind: 'full' | 'topic'; topic: string; score: number; correct: number; total: number; completedAt: number }
type Saved = { examHistory?: ExamHistoryRecord[]; mistakes?: MistakeRecord[]; theme: 'dark' | 'light'; name: string; done: string[]; startedLessons?: string[]; studySeconds?: number; passedUnits?: string[]; masteredUnits?: string[]; lastScore: number | null; avatar?: string; avatarX?: number; avatarY?: number; avatarZoom?: number }
type ChoiceTask = { kind: 'choice'; unit?: string; id: string; number: number; title: string; question: string; choices: string[]; correct: number; rationale: string }
type WritingTask = { kind: 'writing'; id: string; number: number; title: string; instructions: string; sourceText?: string; hideSource?: boolean; minWords: number; rubric: string[]; promptOptions?: string[] }
type ExamTask = ChoiceTask | WritingTask
const storageKey = 'russian-yasno-v2'
const cloudSessionKey = 'russian-yasno-cloud-session-v1'
type CloudSession = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email?: string } }
const cloudConfig = { url: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, ''), key: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined }
const cloudReadyConfig = Boolean(cloudConfig.url && cloudConfig.key)
const readCloudSession = (): CloudSession | null => {
 try { const value = JSON.parse(localStorage.getItem(cloudSessionKey) || 'null') as CloudSession | null; return value?.access_token && value?.refresh_token && value?.user?.id ? value : null } catch { return null }
}
const cloudRequest = async (path: string, session?: CloudSession, init: RequestInit = {}) => {
 if (!cloudReadyConfig) throw new Error('Облачная синхронизация ещё не настроена владельцем сайта.')
 const headers = new Headers(init.headers)
 headers.set('apikey', cloudConfig.key!)
 headers.set('Content-Type', 'application/json')
 if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
 const response = await fetch(`${cloudConfig.url}${path}`, { ...init, headers })
 const body = await response.text()
 let parsed: any = null
 try { parsed = body ? JSON.parse(body) : null } catch { parsed = body }
 if (!response.ok) throw new Error(parsed?.msg || parsed?.message || parsed?.error_description || parsed?.error || `Ошибка облачного сервиса (${response.status})`)
 return parsed
}
const refreshCloudSession = async (session: CloudSession): Promise<CloudSession> => {
 if (session.expires_at > Date.now() + 60_000) return session
 const result = await cloudRequest('/auth/v1/token?grant_type=refresh_token', undefined, { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) })
 const refreshed: CloudSession = { ...result, expires_at: Date.now() + Number(result.expires_in || 3600) * 1000 }
 localStorage.setItem(cloudSessionKey, JSON.stringify(refreshed))
 return refreshed
}
const initial: Saved = { examHistory: [], mistakes: [], theme: 'dark', name: 'Ученик', done: [], startedLessons: [], studySeconds: 0, passedUnits: [], masteredUnits: [], lastScore: null, avatar: '', avatarX: 50, avatarY: 50, avatarZoom: 100 }
const sanitizeSaved = (value: unknown): Saved => {
 if (!value || typeof value !== 'object') return initial
 const data = value as Partial<Saved>
 const validAvatar = typeof data.avatar === 'string' && data.avatar.length <= 1_500_000 && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(data.avatar) ? data.avatar : ''
 return {
  ...initial,
  theme: data.theme === 'light' ? 'light' : 'dark',
  name: typeof data.name === 'string' ? data.name.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 28) || 'Ученик' : initial.name,
  examHistory: Array.isArray(data.examHistory) ? data.examHistory.filter((item): item is ExamHistoryRecord => Boolean(item && typeof item === 'object' && typeof (item as ExamHistoryRecord).id === 'string' && ['base','oge','ege'].includes((item as ExamHistoryRecord).track) && typeof (item as ExamHistoryRecord).score === 'number')).slice(0, 100) : [],
  mistakes: Array.isArray(data.mistakes) ? data.mistakes.filter((item): item is MistakeRecord => Boolean(item && typeof item === 'object' && typeof (item as MistakeRecord).id === 'string' && ['base','oge','ege'].includes((item as MistakeRecord).track) && typeof (item as MistakeRecord).question === 'string')).slice(0, 200) : [],
  done: Array.isArray(data.done) ? [...new Set(data.done.filter((item): item is string => typeof item === 'string' && item.length <= 120))].slice(0, 500) : [],
  startedLessons: Array.isArray(data.startedLessons) ? [...new Set(data.startedLessons.filter((item): item is string => typeof item === 'string' && item.length <= 120))].slice(0, 500) : [],
  studySeconds: typeof data.studySeconds === 'number' && Number.isFinite(data.studySeconds) ? Math.max(0, Math.min(100_000_000, Math.floor(data.studySeconds))) : 0,
  passedUnits: Array.isArray(data.passedUnits) ? [...new Set(data.passedUnits.filter((item): item is string => typeof item === 'string' && item.length <= 180))].slice(0, 100) : [],
  masteredUnits: Array.isArray(data.masteredUnits) ? [...new Set(data.masteredUnits.filter((item): item is string => typeof item === 'string' && item.length <= 180))].slice(0, 100) : [],
  lastScore: typeof data.lastScore === 'number' && Number.isFinite(data.lastScore) ? Math.max(0, Math.min(100, Math.round(data.lastScore))) : null,
  avatar: validAvatar,
  avatarX: typeof data.avatarX === 'number' && Number.isFinite(data.avatarX) ? Math.max(0, Math.min(100, data.avatarX)) : 50,
  avatarY: typeof data.avatarY === 'number' && Number.isFinite(data.avatarY) ? Math.max(0, Math.min(100, data.avatarY)) : 50,
  avatarZoom: typeof data.avatarZoom === 'number' && Number.isFinite(data.avatarZoom) ? Math.max(100, Math.min(250, data.avatarZoom)) : 100,
 }
}
const readSaved = (): Saved => {
 try {
  const raw = localStorage.getItem(storageKey) || localStorage.getItem('slovesnost-academy-v1')
  return raw ? sanitizeSaved(JSON.parse(raw) as unknown) : initial
 } catch { return initial }
}
const nav: { id: View; icon: string; label: string }[] = [{ id: 'home', icon: '⌂', label: 'Главная' }, { id: 'lessons', icon: '▤', label: 'Уроки' }, { id: 'practice', icon: '✎', label: 'Тренажёры' }, { id: 'exams', icon: '◷', label: 'Экзамены' }, { id: 'progress', icon: '↗', label: 'Прогресс' }]
const wordCount = (value: string) => value.trim() ? value.trim().split(/\s+/).length : 0
function buildExam(route: 'base' | 'oge' | 'ege', variant: number, kind: 'full' | 'topic', topic: string): ExamTask[] {
 const questions = buildIndependentChoices(route, variant, kind === 'topic' ? topic : '') as ChoiceTask[]
 if (kind === 'topic' || route === 'base') return questions
 if (route === 'oge') {
  return [
   { kind: 'writing', id: `oge-summary-${variant}`, number: 1, title: 'Сжатое изложение', instructions: 'Прослушай текст два раза. Передай каждую микротему, используй приёмы сжатия и сохрани главную мысль. Затем проверь логику, орфографию и пунктуацию.', sourceText: ogeSourceTexts[(variant - 1) % ogeSourceTexts.length], hideSource: true, minWords: 70, rubric: ['Сохранены все микротемы и позиция автора', 'Текст сжат без подмены смысла и логических потерь', 'Объём не менее 70 слов; грамотность проверена'] },
   ...questions.map((task, index) => ({ ...task, number: index + 2 })),
   { kind: 'writing', id: `oge-essay-${variant}`, number: 13, title: 'Сочинение-рассуждение', instructions: 'Выбери одну тему. Сформулируй тезис, приведи два примера из текста и обязательно поясни каждый, назови смысловую связь и сделай вывод.', sourceText: ogeSourceTexts[variant % ogeSourceTexts.length], minWords: 70, promptOptions: ['13.1 · Объясни роль выбранного языкового средства в тексте.', '13.2 · Раскрой смысл предложенного фрагмента текста.', '13.3 · Ответь на вопрос о нравственном понятии, опираясь на текст.'], rubric: ['К1 · дан прямой ответ на выбранную тему', 'К2 · приведены два примера из текста и пояснён каждый', 'К3 · смысловая связь названа и объяснена; есть вывод', 'Не менее 70 слов; соблюдены логика, речь и грамотность'] },
  ]
 }
 return [
  ...questions.map((task, index) => ({ ...task, number: index + 1 })),
  { kind: 'writing', id: `ege-essay-${variant}`, number: 27, title: 'Сочинение по прочитанному тексту', instructions: 'Определи проблему и позицию автора. Дай комментарий с двумя примерами-иллюстрациями и поясни их смысловую связь. Вырази и аргументируй своё отношение, сделай вывод.', sourceText: egeSourceTexts[(variant - 1) % egeSourceTexts.length], minWords: 150, rubric: ['Проблема и позиция автора сформулированы точно', 'Два примера из текста сопровождаются пояснениями', 'Смысловая связь между примерами названа и объяснена', 'Собственное отношение обосновано; соблюдены логика и нормы речи', 'Объём не менее 150 слов; сверь критерии ФИПИ нужного года'] },
 ]
}
const explanationStopWords = new Set(['это','этот','эта','эти','для','при','как','что','чтобы','если','или','его','её','они','она','оно','также','когда','потому','можно','нужно','есть','быть','свой','свои','надо','тогда','здесь','там','который','которая','которые','такой','такая','такое','бы','мы','вы','я','он','все','всё','уже','ещё','еще','мне','моя','мой','твой','правило','урок','слово','слова','слове','словом'])
function normalizeRussianTerm(word: string) {
 return word.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/(иями|ями|ами|его|ого|ему|ому|ыми|ими|иях|ах|ях|иям|ям|ам|ом|ем|ой|ей|ий|ый|ая|яя|ое|ее|ые|ие|ую|юю|а|я|ы|и|у|ю|е|о)$/u, '').slice(0, 7)
}
function formatClock(totalSeconds: number) {
 const minutes = Math.floor(Math.max(0, totalSeconds) / 60)
 const seconds = Math.max(0, totalSeconds) % 60
 return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
type ExplanationEvaluation = { ok: boolean; score: number; message: string; criteria: { label: string; score: number; max: number; detail: string }[] }
function checkLessonExplanation(value: string, lesson: Lesson): ExplanationEvaluation {
 const clean = value.toLocaleLowerCase('ru').replace(/ё/g, 'е')
 const words = clean.match(/[а-я]{3,}/g) ?? []
 const uniqueWords = new Set(words)
 const source = [lesson.title, lesson.aim, lesson.rule, lesson.rationale, lesson.explainPrompt, lesson.text.join(' '), lesson.example].join(' ').toLocaleLowerCase('ru').replace(/ё/g, 'е')
 const stop = new Set([...explanationStopWords, 'когда','также','например','значение','является','помогает','которое','которые','может','будет','этого','этому','этими','этим','такого','такой','такие','данном','данные','часть','случае','сначала','затем','нужно','следует','слово','словом'])
 const stem = (word: string) => normalizeRussianTerm(word)
 const sourceTerms = [...new Set((source.match(/[а-я]{4,}/g) ?? []).filter(w => !stop.has(w)).map(stem).filter(w => w.length >= 4))]
 const answerTerms = [...uniqueWords].filter(w => !stop.has(w)).map(stem).filter(w => w.length >= 4)
 const hits = sourceTerms.filter(term => answerTerms.some(word => word === term || word.startsWith(term) || term.startsWith(word)))
 const conceptCoverage = sourceTerms.length ? hits.length / Math.min(8, sourceTerms.length) : 0
 const reasoningPatterns = [/потому что/u,/так как/u,/поскольку/u,/поэтому/u,/следовательно/u,/значит/u,/из этого следует/u,/это показывает/u,/это означает/u,/указывает на/u,/свидетельствует/u,/если .{2,50} то/u,/в результате/u]
 const reasoning = reasoningPatterns.some(pattern => pattern.test(clean))
 const applicationPatterns = [/например/u,/в предложени/u,/в слове/u,/в данном пример/u,/здесь/u,/в этом случа/u,/по вопросу/u,/проверя/u,/можно подстав/u,/заменить/u,/найти основ/u,/зада[её]м вопрос/u,/согласу/u,/зависит/u,/относится/u]
 const application = applicationPatterns.some(pattern => pattern.test(clean))
 const hasSpecificTerm = hits.length >= 2
 const enough = words.length >= 8 && value.trim().length >= 45
 const hasBareCopy = value.trim().length > 0 && value.trim().toLocaleLowerCase('ru') === lesson.rule.trim().toLocaleLowerCase('ru')
 const contradiction = /неправильно|не верно|неверно|не ставится|не пишется|не согласуется|не зависит/u.test(clean) && /правильно|верно|ставится|пишется|согласуется|зависит/u.test(clean)
 const criteria = [
  { label: 'Понимание темы', score: conceptCoverage >= .34 ? 2 : conceptCoverage >= .17 ? 1 : 0, max: 2, detail: conceptCoverage >= .34 ? 'Есть несколько понятий, относящихся к теме.' : conceptCoverage >= .17 ? 'Упомянута часть ключевых понятий; раскрой правило точнее.' : 'Не хватает терминов и понятий именно из этого урока.' },
  { label: 'Точность правила', score: hasSpecificTerm && !contradiction ? 2 : hasSpecificTerm ? 1 : 0, max: 2, detail: contradiction ? 'В ответе обнаружены взаимоисключающие формулировки — проверь вывод.' : hasSpecificTerm ? 'Есть опора на ключевые понятия; проверь, не перепутаны ли условия.' : 'Назови конкретное правило или грамматический признак.' },
  { label: 'Обоснование', score: reasoning ? 2 : 0, max: 2, detail: reasoning ? 'Есть причинно-следственная или пояснительная связь.' : 'Добавь связку «потому что», «так как», «поэтому» и объясни ход мысли.' },
  { label: 'Применение', score: application ? 2 : 0, max: 2, detail: application ? 'Есть попытка применить правило к примеру или способу проверки.' : 'Покажи, как правило работает в конкретном слове или предложении.' },
  { label: 'Полнота и самостоятельность', score: enough && !hasBareCopy ? 2 : words.length >= 5 && !hasBareCopy ? 1 : 0, max: 2, detail: hasBareCopy ? 'Нельзя просто переписать правило: объясни его своими словами.' : enough ? 'Ответ достаточно развёрнут.' : 'Раскрой мысль подробнее: желательно 8 и более слов.' }
 ]
 const score = criteria.reduce((sum, item) => sum + item.score, 0)
 const ok = score >= 7 && criteria[0].score > 0 && criteria[2].score > 0 && !contradiction && !hasBareCopy
 const details = criteria.map(item => `${item.label}: ${item.score}/${item.max} — ${item.detail}`).join('\n')
 const message = `${ok ? 'Предварительная оценка: зачёт' : 'Предварительная оценка: пока не зачтено'} · ${score}/10\n${details}\n\nПроверка выполняется по критериям и содержанию урока локально в браузере; это не экспертная семантическая оценка и не официальный балл ОГЭ.`
 return { ok, score, message, criteria }
}

function App() {
 const [saved, setSaved] = useState(readSaved)
 const savedRef = useRef(saved)
 const cloudHydratedUserRef = useRef<string | null>(null)
 const [isOnline, setIsOnline] = useState(() => navigator.onLine)
 const [cloudSession, setCloudSession] = useState<CloudSession | null>(() => readCloudSession())
 const [cloudEmail, setCloudEmail] = useState('')
 const [cloudPassword, setCloudPassword] = useState('')
 const [cloudBusy, setCloudBusy] = useState(false)
 const [cloudStatus, setCloudStatus] = useState(cloudReadyConfig ? 'Облако не подключено' : 'Нужно настроить Supabase')
 const [cloudHydrated, setCloudHydrated] = useState(false)
 const [view, setView] = useState<View>('home')
 const [trackId, setTrackId] = useState<'base' | 'oge' | 'ege'>('oge')
 const [selectedLesson, setSelectedLesson] = useState('oge-1-1')
 const [openedLesson, setOpenedLesson] = useState(false)
 const [lessonAnswer, setLessonAnswer] = useState<number | null>(null)
 const [lessonExplanation, setLessonExplanation] = useState('')
 const [explanationFeedback, setExplanationFeedback] = useState('')
 const [explanationAccepted, setExplanationAccepted] = useState(false)
 const [lessonCheckSubmitted, setLessonCheckSubmitted] = useState(false)
 const [practiceMode, setPracticeMode] = useState<PracticeMode>('dictation')
 const [dictation, setDictation] = useState(() => generateDictation())
 const [practiceSeed, setPracticeSeed] = useState(0)
 const [dictationVisible, setDictationVisible] = useState(false)
 const [spelling, setSpelling] = useState(() => generateSpellingPractice())
 const [punctuation, setPunctuation] = useState(() => generatePunctuationPractice())
 const [practiceText, setPracticeText] = useState('')
 const [practiceChecked, setPracticeChecked] = useState(false)
 const [photoUrl, setPhotoUrl] = useState('')
 const [photoFile, setPhotoFile] = useState<File | null>(null)
 const [ocrBusy, setOcrBusy] = useState(false)
 const [ocrProgress, setOcrProgress] = useState(0)
 const [ocrMessage, setOcrMessage] = useState('')
 const [examTrack, setExamTrack] = useState<'base' | 'oge' | 'ege'>('oge')
 const [examVariant, setExamVariant] = useState(1)
 const [examKind, setExamKind] = useState<'full' | 'topic'>('full')
 const [selectedTopic, setSelectedTopic] = useState('')
 const [examRunning, setExamRunning] = useState(false)
 const [examIndex, setExamIndex] = useState(0)
 const [answers, setAnswers] = useState<number[]>([])
 const [writtenAnswers, setWrittenAnswers] = useState<Record<number, string>>({})
 const [selectedPrompts, setSelectedPrompts] = useState<Record<number, number>>({})
 const [timeLeft, setTimeLeft] = useState(0)
 const [examScore, setExamScore] = useState<number | null>(null)
 const [notice, setNotice] = useState('')
 const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
 const [avatarEditorOpen, setAvatarEditorOpen] = useState(false)
 const allLessons = useMemo(() => tracks.flatMap(track => track.lessons), [])
 const track = tracks.find(entry => entry.id === trackId)!
 const currentLesson = track.lessons.find(entry => entry.id === selectedLesson) ?? track.lessons[0]
 const firstUncompletedIndex = track.lessons.findIndex(item => !saved.done.includes(item.id))
 const lessonIsLocked = (lesson: Lesson) => { const index = track.lessons.findIndex(item => item.id === lesson.id); if (saved.done.includes(lesson.id)) return false; const previous = track.lessons[index - 1]; if (previous && previous.unit !== lesson.unit && !((saved.passedUnits ?? []).includes(`${track.id}:${previous.unit}`))) return true; return firstUncompletedIndex >= 0 && index > firstUncompletedIndex }
 const completion = Math.round(saved.done.filter(id => allLessons.some(item => item.id === id)).length * 100 / totalLessons)
 const examQuestions = useMemo(() => buildExam(examTrack, examVariant, examKind, selectedTopic), [examTrack, examVariant, examKind, selectedTopic])
 const currentExamTask = examQuestions[examIndex]
 const practiceExpected = practiceMode === 'dictation' ? dictation.text : practiceMode === 'spelling' ? spelling.answer : punctuation.answer
 const practicePrompt = practiceMode === 'dictation' ? dictation.text : practiceMode === 'spelling' ? spelling.masked : punctuation.masked
 const practiceTitle = practiceMode === 'dictation' ? dictation.title : practiceMode === 'spelling' ? spelling.title : punctuation.title

 useEffect(() => { savedRef.current = saved }, [saved])
 useEffect(() => { if (cloudSession && !isOnline) setCloudStatus('Офлайн: изменения сохраняются на устройстве и отправятся при подключении.') }, [isOnline, cloudSession?.user.id])
 useEffect(() => { const update = () => setIsOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update); return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) } }, [])
 useEffect(() => {
  if (!cloudSession || !cloudReadyConfig) { setCloudHydrated(false); cloudHydratedUserRef.current = null; return }
  if (cloudHydratedUserRef.current === cloudSession.user.id) { setCloudHydrated(true); return }
  let cancelled = false
  ;(async () => {
   try {
    const session = await refreshCloudSession(cloudSession)
    if (cancelled) return
    const rows = await cloudRequest(`/rest/v1/user_progress?user_id=eq.${encodeURIComponent(session.user.id)}&select=data,updated_at&limit=1`, session)
    if (cancelled) return
    if (Array.isArray(rows) && rows[0]?.data) {
     const restore = window.confirm('В облаке найдена сохранённая копия прогресса. Загрузить её на это устройство? Нажми «Отмена», чтобы отправить текущий локальный прогресс в облако.')
     if (restore) setSaved(sanitizeSaved(rows[0].data))
     else await cloudRequest('/rest/v1/user_progress?on_conflict=user_id', session, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: session.user.id, data: savedRef.current, updated_at: new Date().toISOString() }) })
    } else {
     await cloudRequest('/rest/v1/user_progress?on_conflict=user_id', session, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: session.user.id, data: savedRef.current, updated_at: new Date().toISOString() }) })
    }
    if (!cancelled) { cloudHydratedUserRef.current = session.user.id; if (session !== cloudSession) setCloudSession(session); setCloudHydrated(true); setCloudStatus('Синхронизация включена') }
   } catch (error) {
    if (!cancelled) { setCloudHydrated(false); setCloudStatus(error instanceof Error ? error.message : 'Ошибка подключения к облаку') }
   }
  })()
  return () => { cancelled = true }
 }, [cloudSession])
 useEffect(() => {
  if (!cloudSession || !cloudHydrated || !cloudReadyConfig || !isOnline) return
  const timer = window.setTimeout(async () => {
   try {
    const session = await refreshCloudSession(cloudSession)
    if (session !== cloudSession) setCloudSession(session)
    await cloudRequest('/rest/v1/user_progress?on_conflict=user_id', session, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: session.user.id, data: saved, updated_at: new Date().toISOString() }) })
    setCloudStatus('Синхронизировано')
   } catch (error) { setCloudStatus(error instanceof Error ? error.message : 'Не удалось синхронизировать') }
  }, 1400)
  return () => window.clearTimeout(timer)
 }, [saved, cloudSession, cloudHydrated, isOnline])
 useEffect(() => {
  document.documentElement.dataset.theme = saved.theme
  try {
   localStorage.setItem(storageKey, JSON.stringify(saved))
  } catch (error) {
   console.warn('Не удалось сохранить прогресс на устройстве', error)
   setNotice(current => current === 'Не удалось сохранить прогресс: память браузера заполнена или недоступна. Удали фото профиля или освободи место в браузере.' ? current : 'Не удалось сохранить прогресс: память браузера заполнена или недоступна. Удали фото профиля или освободи место в браузере.')
  }
 }, [saved])
 useEffect(() => { if (photoUrl) return () => URL.revokeObjectURL(photoUrl) }, [photoUrl])
 useEffect(() => {
  const timer = window.setInterval(() => {
   if (document.visibilityState === 'visible') setSaved(value => ({ ...value, studySeconds: (value.studySeconds ?? 0) + 60 }))
  }, 60_000)
  return () => window.clearInterval(timer)
 }, [])
 useEffect(() => {
  if (view !== 'lessons' || !openedLesson) return
  window.scrollTo({ top: 0, behavior: 'instant' })
  const frame = requestAnimationFrame(() => {
   const backdrop = document.querySelector<HTMLElement>('.lesson-focus-backdrop')
   const panel = document.querySelector<HTMLElement>('.lesson-detail')
   if (backdrop) backdrop.scrollTo({ top: 0, behavior: 'instant' })
   if (panel) panel.scrollTo({ top: 0, behavior: 'instant' })
  })
  return () => cancelAnimationFrame(frame)
 }, [view, openedLesson, selectedLesson])

 const go = (next: View) => { setView(next); setOpenedLesson(false); setNotice(''); setMobileMenuOpen(false) }
 const progressByTrack = (id: string) => { const route = tracks.find(entry => entry.id === id); if (!route || !route.lessons.length) return 0; return Math.round(route.lessons.filter(item => saved.done.includes(item.id)).length * 100 / route.lessons.length) }
 const chooseTrack = (id: 'base' | 'oge' | 'ege') => { const route = tracks.find(entry => entry.id === id); if (!route || !route.lessons.length) { setNotice('В этой программе пока нет доступных уроков.'); return } setTrackId(id); setSelectedLesson(route.lessons[0].id); setOpenedLesson(false); setView('lessons'); setMobileMenuOpen(false) }
 const openLesson = (lesson: Lesson, id: 'base' | 'oge' | 'ege') => { const route = tracks.find(entry => entry.id === id)!; const firstPending = route.lessons.find(item => !saved.done.includes(item.id)); const targetIndex = route.lessons.findIndex(item => item.id === lesson.id); const pendingIndex = firstPending ? route.lessons.findIndex(item => item.id === firstPending.id) : route.lessons.length; if (targetIndex > pendingIndex && !saved.done.includes(lesson.id)) { setTrackId(id); setView('lessons'); setNotice(`Сначала пройди урок «${firstPending?.title ?? 'предыдущий урок'}». Следующие уроки откроются после зачёта.`); setOpenedLesson(false); return } setTrackId(id); setSelectedLesson(lesson.id); setSaved(value => ({ ...value, startedLessons: [...new Set([...(value.startedLessons ?? []), lesson.id])] })); setLessonAnswer(null); setLessonExplanation(''); setExplanationFeedback(''); setExplanationAccepted(saved.done.includes(lesson.id)); setLessonCheckSubmitted(false); setOpenedLesson(true); setView('lessons'); setMobileMenuOpen(false) }
  const checkLessonAll = () => {
   setLessonCheckSubmitted(true)
   if (lessonAnswer === null || !lessonExplanation.trim()) {
    setExplanationAccepted(false); setExplanationFeedback('Выбери вариант ответа и напиши объяснение, затем проверь всё одной кнопкой.'); return
   }
   if (lessonAnswer !== currentLesson.correct) {
    setExplanationAccepted(false); setExplanationFeedback(`Ответ пока неверный. ${currentLesson.rationale}`); return
   }
   const result = checkLessonExplanation(lessonExplanation, currentLesson)
   setExplanationAccepted(result.ok); setExplanationFeedback(`${result.message}\n\nТестовый ответ: верно.`)
  }
  const completeLesson = () => {
   if (lessonAnswer !== currentLesson.correct || !explanationAccepted) { setNotice('Сначала успешно проверь тестовый ответ и письменное объяснение одной кнопкой.'); return }
   const updatedDone = saved.done.includes(currentLesson.id) ? saved.done : [...saved.done, currentLesson.id]
   setSaved(value => ({ ...value, done: updatedDone }))
   const lessonIndex = track.lessons.findIndex(item => item.id === currentLesson.id)
   const nextLesson = track.lessons[lessonIndex + 1]
   if (!nextLesson || nextLesson.unit !== currentLesson.unit) {
    setOpenedLesson(false)
    setNotice(`Все уроки раздела «${currentLesson.unit}» пройдены. Начинается мини-экзамен по разделу.`)
    startExam(track.id, 1, 'topic', currentLesson.unit)
    return
   }
   if (nextLesson) {
    setSelectedLesson(nextLesson.id); setLessonAnswer(null); setLessonExplanation(''); setExplanationFeedback(''); setExplanationAccepted(false); setLessonCheckSubmitted(false)
    setNotice(`Урок «${currentLesson.title}» зачтён. Открыт следующий урок.`)
    window.scrollTo({ top: 0, behavior: 'instant' })
   } else {
    setOpenedLesson(false); setNotice(`Маршрут «${track.name}» завершён. Все уроки этого раздела пройдены.`)
   }
  }
  const newPractice = (mode = practiceMode) => { const seed = practiceSeed + 1; setPracticeSeed(seed); setPracticeMode(mode); setPracticeText(''); setPracticeChecked(false); setNotice(''); if (mode === 'dictation') { setDictation(generateDictation(seed)); setDictationVisible(false) } if (mode === 'spelling') setSpelling(generateSpellingPractice(seed)); if (mode === 'punctuation') setPunctuation(generatePunctuationPractice(seed)) }
 const cloudAuth = async (mode: 'login' | 'signup') => {
  if (!cloudReadyConfig) { setCloudStatus('Облачная база ещё не настроена владельцем сайта.'); return }
  if (!cloudEmail.trim() || !cloudPassword) { setCloudStatus('Введи электронную почту и пароль.'); return }
  setCloudBusy(true); setCloudStatus('Подключаюсь…')
  try {
   const result = await cloudRequest(mode === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', undefined, { method: 'POST', body: JSON.stringify({ email: cloudEmail.trim(), password: cloudPassword }) })
   if (!result?.access_token || !result?.refresh_token || !result?.user?.id) {
    setCloudStatus(mode === 'signup' ? 'Аккаунт создан. Если включено подтверждение почты, подтверди адрес и затем войди.' : 'Сервис не вернул активную сессию. Проверь подтверждение почты.')
   } else {
    const session: CloudSession = { ...result, expires_at: Date.now() + Number(result.expires_in || 3600) * 1000 }
    localStorage.setItem(cloudSessionKey, JSON.stringify(session)); setCloudSession(session); setCloudStatus('Аккаунт подключён. Загружаю данные…'); setCloudPassword('')
   }
  } catch (error) { setCloudStatus(error instanceof Error ? error.message : 'Не удалось выполнить вход.') }
  finally { setCloudBusy(false) }
 }
 const cloudLogout = async () => {
  const current = cloudSession
  try { if (current && cloudReadyConfig) await cloudRequest('/auth/v1/logout', current, { method: 'POST' }) } catch { /* Local logout must work even if the network is unavailable. */ }
  localStorage.removeItem(cloudSessionKey); cloudHydratedUserRef.current = null; setCloudSession(null); setCloudHydrated(false); setCloudStatus('Облако отключено на этом устройстве.')
 }
 const exportBackup = () => {
  try {
   const payload = { app: 'russian-yasno', backupVersion: 1, exportedAt: new Date().toISOString(), data: saved }
   const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
   const url = URL.createObjectURL(blob)
   const link = document.createElement('a')
   link.href = url
   link.download = `russian-yasno-backup-${new Date().toISOString().slice(0,10)}.json`
   document.body.appendChild(link); link.click(); link.remove()
   window.setTimeout(() => URL.revokeObjectURL(url), 1000)
   setNotice('Резервная копия подготовлена. Перенеси JSON-файл на другое устройство и импортируй его в настройках.')
  } catch { setNotice('Не удалось создать резервную копию. Проверь свободное место на устройстве.') }
 }
 const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0]
  if (!file) return
  event.target.value = ''
  if (file.size > 5 * 1024 * 1024) { setNotice('Файл резервной копии слишком большой. Максимум — 5 МБ.'); return }
  try {
   const parsed = JSON.parse(await file.text()) as { app?: string; backupVersion?: number; data?: unknown }
   if (parsed?.app !== 'russian-yasno' || parsed.backupVersion !== 1 || !parsed.data || typeof parsed.data !== 'object' || !Array.isArray((parsed.data as Partial<Saved>).done) || !['dark','light'].includes(String((parsed.data as Partial<Saved>).theme))) {
    setNotice('Файл не распознан как резервная копия «Русский Ясно».'); return
   }
   const restored = sanitizeSaved(parsed.data)
   if (!window.confirm('Импорт заменит текущий прогресс на этом устройстве данными из резервной копии. Продолжить?')) return
   setSaved(restored); setNotice('Прогресс восстановлен из резервной копии.')
  } catch { setNotice('Не удалось прочитать файл. Выбери корректную резервную копию JSON.') }
 }
 const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setOcrMessage('Поддерживаются изображения JPG, PNG и WEBP.'); event.target.value = ''; return }
  if (file.size > 12 * 1024 * 1024) { setOcrMessage('Изображение слишком большое. Максимальный размер — 12 МБ.'); event.target.value = ''; return }
  setPhotoFile(file); setPhotoUrl(URL.createObjectURL(file)); setPracticeChecked(false); setOcrMessage('Фото готово. Нажми «Распознать текст», чтобы перенести запись в поле проверки.'); event.target.value = ''
 }
 const recognizePhoto = async () => {
  if (!photoFile) return
  setOcrBusy(true); setOcrProgress(0); setOcrMessage('Загружаю русскую модель распознавания…')
  let worker: { terminate: () => Promise<unknown>; recognize: (...args: any[]) => Promise<any> } | undefined
  try {
   const { createWorker } = await import('tesseract.js')
   worker = await createWorker('rus', 1, { logger: message => { if (message.status === 'recognizing text') { setOcrMessage('Распознаю текст на устройстве…'); setOcrProgress(Math.round(message.progress * 100)) } else if (message.status === 'loading language traineddata') { setOcrMessage('Загружаю языковые данные…') } } })
   const { data } = await worker.recognize(photoFile)
   setPracticeText(data.text.trim()); setPracticeChecked(false); setOcrProgress(100); setOcrMessage(`Распознано. Оценка OCR ${Math.round(data.confidence)}%; проверь распознанные буквы и знаки, затем нажми «Проверить ответ».`)
  } catch (error) { setOcrMessage(`Не удалось распознать фото: ${error instanceof Error ? error.message : 'ошибка OCR'}. Попробуй чёткий снимок при хорошем освещении.`) }
  finally { await worker?.terminate(); setOcrBusy(false) }
 }
 const startExam = (route: 'base' | 'oge' | 'ege', variant = 1, kind: 'full' | 'topic' = 'full', topic = '') => {
  const items = buildExam(route, variant, kind, topic)
  if (!items.length) { setNotice('Для выбранного раздела пока нет заданий. Выбери другую тему.'); return }
  setExamTrack(route); setExamVariant(variant); setExamKind(kind); setSelectedTopic(topic); setView('exams'); setExamRunning(true); setExamIndex(0); setAnswers(Array(items.length).fill(-1)); setWrittenAnswers({}); setSelectedPrompts({}); setExamScore(null); setTimeLeft(kind === 'topic' ? 20 * 60 : tracks.find(entry => entry.id === route)!.examMinutes * 60)
 }
 const finishExam = useCallback(() => {
  if (examScore !== null) return
  const objective = examQuestions.filter((item): item is ChoiceTask => item.kind === 'choice')
  const correct = examQuestions.reduce((sum, item, index) => sum + (item.kind === 'choice' && answers[index] === item.correct ? 1 : 0), 0)
  const score = objective.length ? Math.round(correct * 100 / objective.length) : 0
  const newMistakes: MistakeRecord[] = examQuestions.flatMap((item, index) => item.kind === 'choice' && answers[index] !== item.correct ? [{ id: `${examTrack}:${item.title}:${item.question}`, track: examTrack, unit: item.unit || selectedTopic || item.title, title: item.title, question: item.question, wrongAnswer: item.choices[answers[index]] ?? 'Нет ответа', correctAnswer: item.choices[item.correct], rationale: item.rationale, attempts: 1, lastAt: Date.now() }] : [])
  setExamScore(score); setExamRunning(false); setSaved(value => {
   const historyRecord: ExamHistoryRecord = { id: `${Date.now()}-${examTrack}-${examVariant}`, track: examTrack, kind: examKind, topic: selectedTopic, score, correct, total: objective.length, completedAt: Date.now() }
   const examHistory = [historyRecord, ...(value.examHistory ?? [])].slice(0, 100)
   const mergedMistakes = [...(value.mistakes ?? [])]
   for (const mistake of newMistakes) {
    const existing = mergedMistakes.findIndex(entry => entry.id === mistake.id)
    if (existing >= 0) mergedMistakes[existing] = { ...mergedMistakes[existing], wrongAnswer: mistake.wrongAnswer, attempts: mergedMistakes[existing].attempts + 1, lastAt: mistake.lastAt }
    else mergedMistakes.unshift(mistake)
   }
   const boundedMistakes = mergedMistakes.slice(0, 200)
   if (examKind !== 'topic') return { ...value, examHistory, mistakes: boundedMistakes, lastScore: score }
   const unitKey = `${examTrack}:${selectedTopic}`
   if (score >= 67) return { ...value, examHistory, mistakes: boundedMistakes, lastScore: score, passedUnits: [...new Set([...(value.passedUnits ?? []), unitKey])], masteredUnits: score >= 85 ? [...new Set([...(value.masteredUnits ?? []), unitKey])] : (value.masteredUnits ?? []) }
   const route = tracks.find(item => item.id === examTrack)
   const unitLessonIds = route?.lessons.filter(item => item.unit === selectedTopic).map(item => item.id) ?? []
   return { ...value, examHistory, mistakes: boundedMistakes, lastScore: score, done: value.done.filter(id => !unitLessonIds.includes(id)), passedUnits: (value.passedUnits ?? []).filter(key => key !== unitKey), masteredUnits: (value.masteredUnits ?? []).filter(key => key !== unitKey) }
  })
  if (examKind === 'topic') {
   setTrackId(examTrack); setView('lessons'); setOpenedLesson(false)
   if (score < 67) {
    const first = tracks.find(item => item.id === examTrack)?.lessons.find(item => item.unit === selectedTopic)
    if (first) setSelectedLesson(first.id)
    setNotice(`Мини-экзамен: ${score}%. Раздел пока не закреплён. Нужно набрать не менее 67%. Пройди уроки «${selectedTopic}» повторно и сдай экзамен ещё раз.`)
   } else {
    setNotice(`Мини-экзамен сдан: ${score}%. Раздел «${selectedTopic}» закреплён. Следующий раздел открыт.`)
   }
  }
 }, [answers, examQuestions, examScore, examKind, examTrack, selectedTopic])
  useEffect(() => {
   if (!examRunning || examScore !== null || timeLeft <= 0) return
   const timer = window.setTimeout(() => { if (timeLeft === 1) finishExam(); else setTimeLeft(timeLeft - 1) }, 1000)
   return () => window.clearTimeout(timer)
  }, [examRunning, examScore, timeLeft, finishExam])
  useEffect(() => {
   if (examRunning || examScore !== null) document.querySelector(examRunning ? '.exam-session' : '.exam-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [examRunning, examScore])
 useEffect(() => {
  const handleEscape = (event: KeyboardEvent) => {
   if (event.key !== 'Escape') return
   if (mobileMenuOpen) setMobileMenuOpen(false)
   if (openedLesson) setOpenedLesson(false)
   if (view === 'practice') { setView('home'); setNotice('') }
   if (examRunning) { setExamRunning(false); setExamScore(null) }
  }
  window.addEventListener('keydown', handleEscape)
  return () => window.removeEventListener('keydown', handleEscape)
 }, [mobileMenuOpen, openedLesson, view, examRunning])
 const nextExamTask = () => { if (examIndex < examQuestions.length - 1) setExamIndex(index => index + 1); else { const unanswered = examQuestions.reduce((count, task, index) => count + (task.kind === 'choice' ? (answers[index] === -1 ? 1 : 0) : (writtenAnswers[task.number]?.trim() ? 0 : 1)), 0); if (unanswered && !window.confirm(`Осталось незаполненных заданий: ${unanswered}. Завершить экзамен и сдать пустые ответы?`)) return; finishExam() } }
 const jumpExamTask = (index: number) => setExamIndex(Math.max(0, Math.min(examQuestions.length - 1, index)))
 const say = (text: string, rate = 0.84) => { if (!('speechSynthesis' in window)) { setNotice('В этом браузере нет синтеза речи.'); return } const speech = new SpeechSynthesisUtterance(text); speech.lang = 'ru-RU'; speech.rate = rate; window.speechSynthesis.cancel(); window.speechSynthesis.speak(speech) }
 const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setNotice('Выбери изображение в формате JPG, PNG или WEBP.'); event.target.value = ''; return }
  if (file.size > 12 * 1024 * 1024) { setNotice('Файл слишком большой. Выбери изображение до 12 МБ.'); event.target.value = ''; return }
  const reader = new FileReader()
  reader.onerror = () => setNotice('Не удалось прочитать изображение. Попробуй другой файл.')
  reader.onload = () => {
   const image = new Image()
   image.onerror = () => setNotice('Файл не удалось открыть как изображение.')
   image.onload = () => {
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 640 / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) { setNotice('Браузер не смог обработать изображение.'); return }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    try {
     const compressed = canvas.toDataURL('image/jpeg', 0.78)
     setSaved(value => ({ ...value, avatar: compressed, avatarX: 50, avatarY: 50, avatarZoom: 120 }))
     setAvatarEditorOpen(true); setNotice('')
    } catch { setNotice('Не удалось подготовить изображение. Попробуй другой файл.') }
   }
   image.src = String(reader.result)
  }
  reader.readAsDataURL(file); event.target.value = ''
 }

 return <div className="app-shell">
  {mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label="Закрыть меню" onClick={() => setMobileMenuOpen(false)} />}
  <aside className={"sidebar " + (mobileMenuOpen ? "mobile-open" : "")}>
    <button className="brand" aria-label="На главную" onClick={() => go('home')}><span className="brand-icon">Я</span><span>РУССКИЙ<span className="brand-muted"> ЯСНО</span><small>ГРАММОТНОСТЬ БЕЗ ЗАПИНКИ</small></span></button>
   <button className="profile-mini profile-top" onClick={() => go('settings')}><span className="avatar">{saved.avatar ? <img src={saved.avatar} alt="" style={{ objectPosition: `${saved.avatarX ?? 50}% ${saved.avatarY ?? 50}%`, transform: `scale(${(saved.avatarZoom ?? 120) / 100})` }}/> : (saved.name.trim()[0]?.toUpperCase() || 'У')}</span><span><b>{saved.name.trim() || 'Ученик'}</b><small>Личный кабинет</small></span><span className="more">···</span></button>
   <div className="sidebar-label">ОБУЧЕНИЕ</div><nav>{nav.map(item => <button key={item.id} aria-label={item.label} onClick={() => go(item.id)} className={'nav-link ' + (view === item.id ? 'active' : '')}><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{view === item.id && <span className="nav-dot"/>}</button>)}</nav>
   <div className="sidebar-label track-label">ТВОИ МАРШРУТЫ</div><div className="track-nav">{tracks.map(item => <button key={item.id} className={'track-nav-link ' + (trackId === item.id ? 'selected' : '')} onClick={() => chooseTrack(item.id)}><span className={'track-icon ' + item.tone}>{item.icon}</span><span>{item.name}</span><span className="track-percent">{progressByTrack(item.id)}%</span></button>)}</div>
   <div className="sidebar-bottom"><div className="daily-card"><span className="daily-star">✦</span><b>Понимать, а не зубрить</b><p>После каждого урока объясни правило своими словами и закрепи его задачей.</p><button onClick={() => go('practice')}>Открыть тренажёры <span>→</span></button></div></div>
  </aside>
  <main className="main-area"><header className="topbar"><button className="mobile-menu-toggle" aria-label="Открыть меню" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(value => !value)}><span/><span/><span/></button><div className="breadcrumbs"><span>РУССКИЙ ЯСНО</span><span className="crumb-slash">/</span><b>{nav.find(item => item.id === view)?.label.toUpperCase() ?? 'НАСТРОЙКИ'}</b></div><div className="top-actions"><div className="streak-pill"><span>✦</span> Один шаг за раз</div><button className="theme-toggle" onClick={() => setSaved(value => ({ ...value, theme: value.theme === 'dark' ? 'light' : 'dark' }))} aria-label="Сменить тему">{saved.theme === 'dark' ? '☼' : '☾'}</button><button className="top-avatar" aria-label="Настройки" onClick={() => go('settings')}>{saved.avatar ? <img src={saved.avatar} alt="" style={{ objectPosition: `${saved.avatarX ?? 50}% ${saved.avatarY ?? 50}%`, transform: `scale(${(saved.avatarZoom ?? 120) / 100})` }}/> : (saved.name.trim()[0]?.toUpperCase() || 'У')}</button></div></header>
   <div className="content">
    {view === 'home' && <>
     <section className="welcome-row"><div><div className="eyebrow"><span className="live-dot"/> ПОДГОТОВКА С ПОНИМАНИЕМ</div><h1>Русский язык —<br/><span>ясно и по делу.</span></h1><p className="welcome-copy">Уроки учат рассуждать, тренажёры закрепляют навык,<br/>пробники показывают, что повторить дальше.</p><button className="primary-btn" onClick={() => { const next = allLessons.find(item => !saved.done.includes(item.id)) ?? allLessons[0]; const route = tracks.find(entry => entry.lessons.some(lesson => lesson.id === next.id))!; openLesson(next, route.id) }}>Продолжить обучение <span>→</span></button><div className="welcome-foot"><span>✧</span> 100 уроков · ОГЭ, ЕГЭ и фундаментальная грамотность</div></div><div className="hero-art"><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><div className="hero-plate"><span>Я</span><i>ё</i><b>!</b></div><div className="hero-note note-top"><span>✦</span> ПОНЯТНОЕ ПРАВИЛО</div><div className="hero-note note-bottom"><span>↗</span> СВОЁ ОБЪЯСНЕНИЕ</div><div className="hero-spark spark-one">✳</div><div className="hero-spark spark-two">✧</div></div></section>
     <section className="stats-grid dashboard-stats"><article className="stat-card"><span className="stat-icon lilac">▤</span><div><small>УРОКИ ПРОЙДЕНЫ</small><b>{saved.done.filter(id => allLessons.some(item => item.id === id)).length}<i> / {totalLessons}</i></b><span className="stat-caption">{completion}% всей программы</span></div></article><article className="stat-card"><span className="stat-icon mint">◷</span><div><small>ВРЕМЯ ОБУЧЕНИЯ</small><b>{Math.floor((saved.studySeconds ?? 0) / 3600)}<i> ч </i>{Math.floor(((saved.studySeconds ?? 0) % 3600) / 60)}<i> мин</i></b><span className="stat-caption">Время с открытым сайтом</span></div></article><article className="stat-card"><span className="stat-icon blue">◎</span><div><small>НАЧАТЫЕ УРОКИ</small><b>{(saved.startedLessons ?? []).filter(id => allLessons.some(item => item.id === id) && !saved.done.includes(id)).length}<i> в работе</i></b><span className="stat-caption">Ещё предстоит завершить</span></div></article><article className="stat-card"><span className="stat-icon lilac">✦</span><div><small>ПОСЛЕДНИЙ ПРОБНИК</small><b>{saved.lastScore === null ? '—' : `${saved.lastScore}%`}</b><span className="stat-caption">{saved.lastScore === null ? 'Пока нет результата' : 'Результат автопроверки'}</span></div></article></section>
     <section className="dashboard-progress panel"><div className="dashboard-progress-head"><div><div className="eyebrow">ТВОЙ УЧЕБНЫЙ ПУТЬ</div><h2>Прогресс обучения</h2><p>Каждый завершённый урок приближает к уверенному владению языком.</p></div><div className="dashboard-progress-value">{completion}<small>%</small></div></div><div className="dashboard-main-bar"><span style={{ width: completion + '%' }}/></div><div className="dashboard-progress-meta"><b>{saved.done.filter(id => allLessons.some(item => item.id === id)).length} из {totalLessons} уроков завершено</b><span>{Math.max(0, totalLessons - saved.done.filter(id => allLessons.some(item => item.id === id)).length)} осталось</span></div><div className="dashboard-route-list">{tracks.map(item => <div className="dashboard-route" key={item.id}><span className={'track-icon ' + item.tone}>{item.icon}</span><div><div className="dashboard-route-title"><b>{item.name}</b><span>{progressByTrack(item.id)}%</span></div><div className="progress-track"><span style={{ width: progressByTrack(item.id) + '%' }}/></div><small>{item.lessons.filter(lesson => saved.done.includes(lesson.id)).length} из {item.lessons.length} уроков</small></div><button onClick={() => chooseTrack(item.id)}>Открыть →</button></div>)}</div></section>
     <section className="section-block"><div className="section-title"><div><div className="eyebrow">УЧЕБНЫЕ МАРШРУТЫ</div><h2>Сначала опора, затем экзамен</h2></div><button className="subtle-link" onClick={() => go('lessons')}>Открыть программу <span>→</span></button></div><div className="track-grid">{tracks.map(item => <button key={item.id} className="track-card" onClick={() => chooseTrack(item.id)}><div className="track-card-top"><span className={'track-icon large ' + item.tone}>{item.icon}</span><span className="track-arrow">↗</span></div><span className="track-kicker">{item.id === 'base' ? 'ФУНДАМЕНТ' : `ПОДГОТОВКА · ${item.short}`}</span><h3>{item.name}</h3><p>{item.description}</p><div className="track-progress"><div className="progress-track"><span style={{ width: progressByTrack(item.id) + '%' }}/></div><small>{item.lessons.filter(lesson => saved.done.includes(lesson.id)).length} из {item.lessons.length} уроков <b>{progressByTrack(item.id)}%</b></small></div></button>)}</div></section>
     <section className="bottom-grid"><div className="section-block next-lesson"><div className="section-title"><div><div className="eyebrow">СЛЕДУЮЩИЙ ШАГ</div><h2>Продолжай в своём темпе</h2></div></div>{(() => { const next = allLessons.find(item => !saved.done.includes(item.id)) ?? allLessons[0]; const parent = tracks.find(item => item.lessons.some(lesson => lesson.id === next.id))!; return <button className="next-card" onClick={() => openLesson(next, parent.id)}><span className={'track-icon ' + parent.tone}>{parent.icon}</span><div><small>{parent.name} · {next.unit}</small><b>{next.title}</b><span>{next.time} <i>·</i> Правило, пример, самопроверка</span></div><span className="next-arrow">→</span></button> })()}</div><div className="motivation-card"><div className="motivation-icon">✧</div><div className="eyebrow">НЕ ПРОСТО УГАДАТЬ</div><h3>Сможешь объяснить —<br/>значит понял.</h3><p>Каждый урок заканчивается объяснением своими словами и задачей на применение.</p><button onClick={() => go('practice')}>Потренироваться <span>→</span></button></div></section>
    </>}
    {view === 'lessons' && <>
     <PageTitle eyebrow="100 УРОКОВ · 3 МАРШРУТА" title="План подготовки" subtitle="Переходи от понятия к правилу, затем объясняй и применяй его на новом примере."/>
     <div className="tab-row">{tracks.map(item => <button key={item.id} className={trackId === item.id ? 'tab active' : 'tab'} onClick={() => { setTrackId(item.id); setSelectedLesson(item.lessons[0].id); setOpenedLesson(false) }}>{item.short}<span>{item.lessons.length}</span></button>)}</div>
     <div className="lesson-layout"><section className="lesson-list"><div className="track-summary"><div className={'track-icon large ' + track.tone}>{track.icon}</div><div><small>{track.short} · УЧЕБНЫЙ ПЛАН</small><h2>{track.name}</h2><p>{track.description}</p></div><div className="summary-progress"><b>{progressByTrack(track.id)}%</b><span>пройдено</span></div></div><div className="unit-header"><span>ТЕМАТИЧЕСКАЯ ПРОГРАММА · НАЖМИ НА УРОК, ЧТОБЫ ОТКРЫТЬ</span><span>{track.lessons.length} УРОКОВ</span></div>{[...new Set(track.lessons.map(item => item.unit))].map((unit, groupIndex) => <div className="unit-group" key={unit}><div className="unit-title"><span>{String(groupIndex + 1).padStart(2, '0')}</span><b>{unit}</b><small>{track.lessons.filter(item => item.unit === unit).filter(item => saved.done.includes(item.id)).length}/{track.lessons.filter(item => item.unit === unit).length}</small></div>{track.lessons.filter(item => item.unit === unit).map(item => <button key={item.id} disabled={lessonIsLocked(item)} title={lessonIsLocked(item) ? 'Сначала пройди предыдущий урок и мини-экзамен раздела' : item.title} className={'lesson-row ' + (openedLesson && currentLesson.id === item.id ? 'chosen' : '') + (lessonIsLocked(item) ? ' locked' : '')} onClick={() => openLesson(item, track.id)}><span className={'lesson-number ' + (saved.done.includes(item.id) ? 'finished' : '')}>{saved.done.includes(item.id) ? '✓' : lessonIsLocked(item) ? '🔒' : String(track.lessons.indexOf(item) + 1).padStart(2, '0')}</span><span className="lesson-row-text"><small>{item.unit}</small><b>{item.title}</b></span><span className="lesson-time">{item.time}</span><span className="row-arrow">›</span></button>)}{(() => { const unitLessons = track.lessons.filter(item => item.unit === unit); const allDone = unitLessons.every(item => saved.done.includes(item.id)); const passed = (saved.passedUnits ?? []).includes(`${track.id}:${unit}`); const previousUnit = [...new Set(track.lessons.map(item => item.unit))][groupIndex - 1]; const unlocked = groupIndex === 0 || (saved.passedUnits ?? []).includes(`${track.id}:${previousUnit}`); return <div className={'unit-exam-row ' + (passed ? 'passed' : '')}><div><b>{passed ? 'Мини-экзамен сдан' : 'Итоговый мини-экзамен'}</b><small>{passed ? 'Раздел закреплён' : allDone ? 'Уроки завершены — проверь знания по теме' : `${unitLessons.filter(item => saved.done.includes(item.id)).length} из ${unitLessons.length} уроков завершено`}</small></div><button disabled={!allDone || passed || !unlocked} onClick={() => startExam(track.id, 1, 'topic', unit)}>{passed ? '✓ Сдано' : 'Пройти экзамен →'}</button></div> })()}</div>)}</section><aside className="lesson-aside"><div className="aside-card"><div className="eyebrow">МЕТОД РАБОТЫ</div><p><b>1.</b> Разбери понятие и алгоритм.</p><p><b>2.</b> Реши задачу и посмотри объяснение.</p><p><b>3.</b> Объясни правило своими словами.</p><p><b>4.</b> Примени его в другом примере.</p><div className="aside-divider"/><small>Прогресс сохраняется на этом устройстве.</small></div><div className="aside-card target-card"><span>◈</span><b>100 уроков с проверкой понимания</b><p>Всего: 20 базовых занятий, 40 по ОГЭ и 40 по ЕГЭ.</p></div></aside></div>
     {openedLesson && <div className="lesson-focus-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpenedLesson(false) }}><section key={currentLesson.id} className="lesson-detail" role="dialog" aria-modal="true" aria-label={currentLesson.title}><div className="lesson-detail-head"><div><div className="eyebrow">{currentLesson.unit.toUpperCase()} · {currentLesson.time.toUpperCase()}</div><h2>{currentLesson.title}</h2></div><button className="icon-close" onClick={() => setOpenedLesson(false)}>×</button></div><div className="lesson-columns"><div>{currentLesson.text.slice(0, 2).map((paragraph, index) => <p className="lesson-paragraph" key={index}>{paragraph}</p>)}<div className="example-box"><small>РАЗБЕРИ ПРИМЕР</small><p>{currentLesson.example}</p></div><div className="rule-box"><span>✓</span><p><b>АЛГОРИТМ</b>{currentLesson.rule}</p></div><div className="practice-question"><small>ПРИМЕНИ ПРАВИЛО</small><h3>{currentLesson.task}</h3>{currentLesson.choices.map((choice, index) => <button key={choice} aria-pressed={lessonAnswer === index} className={'answer-option ' + (lessonAnswer === index ? lessonCheckSubmitted ? index === currentLesson.correct ? 'correct' : 'incorrect' : 'selected' : '')} onClick={() => { setLessonAnswer(index); setExplanationAccepted(false); setLessonCheckSubmitted(false); setExplanationFeedback('') }}>{'АБВ'[index]} <span>{choice}</span></button>)}<label className="teachback-label">ОБЪЯСНИ СВОИМИ СЛОВАМИ<textarea value={lessonExplanation} onChange={event => { setLessonExplanation(event.target.value); setExplanationAccepted(false); setExplanationFeedback('') }} placeholder={currentLesson.text[2]} rows={3}/><small className="teachback-hint">Напиши объяснение своими словами. Ответ оценивается по пяти критериям: понимание темы, точность правила, обоснование, применение и полнота.</small></label><button className="primary-btn lesson-check-all" type="button" disabled={lessonAnswer === null || lessonExplanation.trim().length < 1} onClick={checkLessonAll}>Проверить задания</button>{explanationFeedback && <pre className={'lesson-notice explanation-score '+(explanationAccepted ? 'success' : '')}>{explanationFeedback}</pre>}<button className="mark-done" disabled={!explanationAccepted || !lessonCheckSubmitted} onClick={completeLesson}>Зачесть урок и продолжить <span>→</span></button>{notice && <p className="lesson-notice">{notice}</p>}</div></div><aside className="lesson-aim"><span>ЦЕЛЬ</span><p>{currentLesson.aim}</p><div className="aside-divider"/><span>ПРОВЕРЬ ПОНИМАНИЕ</span><p>{currentLesson.explainPrompt}</p><button onClick={() => go('practice')}>Закрепить в тренажёре →</button></aside></div></section></div>}
    </>}
    {view === 'practice' && <>
     <div className="practice-focus-screen"><div className="focus-screen-bar"><span>РУССКИЙ ЯСНО · ПРАКТИКА</span><button onClick={() => go('home')}>Закрыть практику ×</button></div>
     <PageTitle eyebrow="ТРЕНАЖЁРЫ ГРАМОТНОСТИ" title="Практика, которая объясняет ошибки" subtitle="Слушай диктант, вставляй орфограммы, расставляй знаки и проверяй каждый ответ."/>
     <div className="practice-tabs">{([{ id: 'dictation', title: 'Диктант', icon: '✎', desc: 'Запись по памяти или под диктовку' }, { id: 'spelling', title: 'Пропущенные буквы', icon: 'А', desc: 'Орфограмма в контексте' }, { id: 'punctuation', title: 'Пунктуация', icon: '、', desc: 'Знаки и их объяснение' }] as const).map(item => <button key={item.id} onClick={() => newPractice(item.id)} className={'practice-mode ' + (practiceMode === item.id ? 'selected' : '')}><span className="mode-icon">{item.icon}</span><span><b>{item.title}</b><small>{item.desc}</small></span>{practiceMode === item.id && <i>✓</i>}</button>)}</div>
     <div className="practice-layout"><section className="practice-work panel"><div className="work-top"><div><div className="eyebrow">{practiceMode === 'dictation' ? 'СЛУШАЙ И ПИШИ' : practiceMode === 'spelling' ? 'ОРФОГРАФИЧЕСКИЙ ТРЕНАЖЁР' : 'ПУНКТУАЦИОННЫЙ ТРЕНАЖЁР'}</div><h2>{practiceTitle}</h2></div><button className="shuffle-btn" onClick={() => newPractice()}>↻ Новое задание</button></div><div className="text-reference"><div className="reference-label"><span>{practiceMode === 'dictation' ? 'ТЕКСТ ДИКТАНТА' : 'ЗАДАНИЕ'}</span><div className="reference-actions">{practiceMode === 'dictation' && <><button onClick={() => say(dictation.text)}>▶ Прослушать</button><button onClick={() => setDictationVisible(value => !value)}>{dictationVisible ? 'Скрыть текст' : 'Показать текст'}</button></>}</div></div><p>{practiceMode === 'dictation' && !dictationVisible ? 'Текст скрыт. Прослушай диктант и запиши его по памяти.' : practicePrompt}</p><small>{practiceMode === 'dictation' ? 'Послушай текст, запиши его в поле ниже и сверься с образцом после проверки.' : practiceMode === 'spelling' ? `Восстанови буквы и объясни правило: ${spelling.rule}` : `Расставь знаки и назови синтаксическое основание: ${punctuation.rule}`}</small></div><label className="write-label">ТВОЙ ВАРИАНТ<textarea value={practiceText} onChange={event => { setPracticeText(event.target.value); setPracticeChecked(false) }} placeholder={practiceMode === 'dictation' ? 'Напиши услышанный текст…' : 'Перепиши предложение полностью, исправив пропуски…'} rows={7}/></label><div className="practice-actions"><button className="primary-btn" disabled={!practiceText.trim()} onClick={() => { setPracticeChecked(true); if (practiceMode === 'dictation') setDictationVisible(true) }}>Проверить ответ <span>→</span></button><span>Проверка покажет расхождения и напомнит правило.</span></div>{practiceChecked && <PracticeResult text={practiceText} expected={practiceExpected} mode={practiceMode} rule={practiceMode === 'spelling' ? spelling.rule : practiceMode === 'punctuation' ? punctuation.rule : 'Сверь слова, окончания и знаки препинания с образцом.'}/>}</section>
      <aside className="practice-side"><div className="upload-card"><div className="upload-icon">▧</div><div className="eyebrow">РАБОТА В ТЕТРАДИ</div><h3>Проверь фото письменно</h3><p>Загрузи снимок. OCR распознает текст в браузере, а ты сможешь поправить распознанное перед сверкой.</p><label className="upload-button">Выбрать фото<input type="file" accept="image/*" onChange={handlePhoto}/></label>{photoUrl && <><img className="notebook-photo" src={photoUrl} alt="Предпросмотр снимка тетради"/><button className="ocr-button" disabled={ocrBusy} onClick={recognizePhoto}>{ocrBusy ? `Распознавание… ${ocrProgress}%` : 'Распознать текст на устройстве'}</button></>}{ocrMessage && <small className="ocr-message">{ocrMessage}</small>}<small className="upload-note">Фото не отправляется на сервер. При первом распознавании браузер скачивает языковую модель; рукописные буквы OCR может прочитать неточно.</small></div><div className="tip-card"><span>✧</span><div><b>Как закрепить правило</b><p>После ответа проговори правило и придумай собственный пример. Это помогает не угадывать, а разбираться.</p></div></div></aside></div>{avatarEditorOpen && saved.avatar && <div className="avatar-editor-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAvatarEditorOpen(false) }}><section className="avatar-editor-modal" role="dialog" aria-modal="true" aria-label="Настройка фотографии"><div className="avatar-editor-head"><div><div className="eyebrow">ПРОФИЛЬ</div><h2>Настрой фотографию</h2><p>Перемещай изображение и подбери масштаб. В профиле останется только готовый аватар.</p></div><button className="icon-close" onClick={() => setAvatarEditorOpen(false)} aria-label="Закрыть">×</button></div><div className="avatar-editor-preview"><div className="avatar-editor-circle"><img src={saved.avatar} alt="Предпросмотр аватара" style={{ objectPosition: `${saved.avatarX ?? 50}% ${saved.avatarY ?? 50}%`, transform: `scale(${(saved.avatarZoom ?? 100) / 100})` }}/></div><small>Так фотография будет выглядеть в профиле</small></div><div className="avatar-editor-controls"><label>Масштаб <b>{saved.avatarZoom ?? 100}%</b><input type="range" min="100" max="250" step="1" value={saved.avatarZoom ?? 120} onChange={event => setSaved(value => ({ ...value, avatarZoom: Number(event.target.value) }))}/></label><label>По горизонтали <b>{saved.avatarX ?? 50}%</b><input type="range" min="0" max="100" value={saved.avatarX ?? 50} onChange={event => setSaved(value => ({ ...value, avatarX: Number(event.target.value) }))}/></label><label>По вертикали <b>{saved.avatarY ?? 50}%</b><input type="range" min="0" max="100" value={saved.avatarY ?? 50} onChange={event => setSaved(value => ({ ...value, avatarY: Number(event.target.value) }))}/></label></div><div className="avatar-editor-actions"><button className="button-quiet" onClick={() => setSaved(value => ({ ...value, avatarX: 50, avatarY: 50, avatarZoom: 120 }))}>Сбросить кадрирование</button><button className="primary-btn" onClick={() => setAvatarEditorOpen(false)}>Сохранить фото</button></div></section></div>}{notice && <div className="toast">{notice}</div>}
     </div>
    </>}
    {view === 'exams' && <>
     <PageTitle eyebrow="НЕЗАВИСИМАЯ ПРОВЕРКА ЗНАНИЙ" title="Экзамены и итоговые проверки" subtitle="Задания составлены отдельно от уроков: новые формулировки, предложения и контексты проверяют применение правил, а не запоминание ответов."/>
     <div className="exam-grid">{tracks.map(item => <article className="exam-card" key={item.id}><div className={'exam-art ' + item.tone}><span>{item.icon}</span><i>✦</i></div><div className="exam-content"><span className="eyebrow">СТРУКТУРА КИМ · {item.examTasks} ЗАДАНИЙ</span><h2>{item.name}</h2><p>{item.description}</p><div className="exam-meta"><span>◷ {Math.floor(item.examMinutes / 60)} ч {item.examMinutes % 60} мин</span><span>{item.id === 'base' ? 'Тест по всем темам' : '✍ Письменная часть'}</span></div><div className="variant-list">{[1, 2, 3].map(variant => <button key={variant} className="variant-button" onClick={() => startExam(item.id, variant)}><small>ВАРИАНТ</small><b>0{variant}</b><span>Начать →</span></button>)}</div></div></article>)}</div>
     <section className="topic-lab panel"><div className="eyebrow">КОРОТКАЯ ДИАГНОСТИКА ПО ТЕМЕ</div><h2>Повтори конкретный раздел</h2><p>Выбери тему и реши новые задания. Формулировки и примеры не повторяют вопросы уроков.</p><div className="topic-lab-controls"><label>Маршрут<select value={examTrack} onChange={event => { setExamTrack(event.target.value as 'base' | 'oge' | 'ege'); setSelectedTopic('') }}>{tracks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Тема<select value={selectedTopic || tracks.find(item => item.id === examTrack)!.lessons[0].unit} onChange={event => setSelectedTopic(event.target.value)}>{[...new Set(tracks.find(item => item.id === examTrack)!.lessons.map(item => item.unit))].map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label><button className="primary-btn" onClick={() => startExam(examTrack, 1, 'topic', selectedTopic || tracks.find(item => item.id === examTrack)!.lessons[0].unit)}>Начать проверку →</button></div></section>
     {(examRunning || examScore !== null) && <div className="exam-focus-screen">{examRunning && currentExamTask && <ExamSession task={currentExamTask} index={examIndex} total={examQuestions.length} progress={examQuestions.length ? Math.round(examQuestions.filter((task, index) => task.kind === 'choice' ? answers[index] !== -1 : Boolean(writtenAnswers[task.number]?.trim())).length * 100 / examQuestions.length) : 0} answer={answers[examIndex] ?? -1} written={writtenAnswers[currentExamTask.number] ?? ''} selectedPrompt={selectedPrompts[currentExamTask.number] ?? -1} timeLeft={timeLeft} answers={answers} writtenAnswers={writtenAnswers} tasks={examQuestions} onJump={jumpExamTask} onAnswer={value => setAnswers(current => current.map((answer, index) => index === examIndex ? value : answer))} onWrite={value => setWrittenAnswers(current => ({ ...current, [currentExamTask.number]: value }))} onSelectPrompt={value => setSelectedPrompts(current => ({ ...current, [currentExamTask.number]: value }))} onBack={() => setExamIndex(index => Math.max(0, index - 1))} onNext={nextExamTask} onExit={() => { if (window.confirm('Выйти из экзамена? Текущие ответы этого варианта не будут сохранены.')) { setExamRunning(false); setExamScore(null) } }} onSpeak={say}/>}{examScore !== null && <ExamResult score={examScore} tasks={examQuestions} answers={answers} written={writtenAnswers} onClose={() => { setExamScore(null); go('exams') }} onRetry={() => startExam(examTrack, examVariant + 1, examKind, selectedTopic)}/>}</div>}
    </>}
    {view === 'progress' && <>
     <PageTitle eyebrow="РЕЗУЛЬТАТЫ И НАВЫКИ" title="Прогресс, который виден" subtitle="Отмечай не только пройденные страницы — фиксируй темы, которые уже можешь объяснить самостоятельно."/>
     <div className="progress-overview"><div className="progress-circle" style={{ '--value': `${completion}%` } as CSSProperties}><div><b>{completion}%</b><span>программы</span></div></div><div><div className="eyebrow">ПРОЙДЕНО УРОКОВ</div><h2>{saved.done.filter(id => allLessons.some(item => item.id === id)).length} из {totalLessons}</h2><p>Урок засчитывается после правильного ответа и проверки объяснения правила своими словами.</p></div><button className="primary-btn" onClick={() => go('lessons')}>Продолжить →</button></div>
     {(() => {
      const history = saved.examHistory ?? []
      const avg = history.length ? Math.round(history.reduce((sum, item) => sum + item.score, 0) / history.length) : 0
      const best = history.length ? Math.max(...history.map(item => item.score)) : 0
      const byTrack = (['base','oge','ege'] as const).map(id => { const items = history.filter(item => item.track === id); return { id, count: items.length, avg: items.length ? Math.round(items.reduce((sum,item)=>sum+item.score,0)/items.length) : 0, best: items.length ? Math.max(...items.map(item=>item.score)) : 0 } })
      const weak = [...tracks].map(route => ({...route, mistakes:(saved.mistakes ?? []).filter(item=>item.track===route.id)})).sort((a,b)=>b.mistakes.length-a.mistakes.length)
      const readiness = (route: 'base'|'oge'|'ege') => {
       const routeLessons = tracks.find(item=>item.id===route)!.lessons
       const units = [...new Set(routeLessons.map(item=>item.unit))]
       const mastered = units.filter(unit=>(saved.masteredUnits??[]).includes(`${route}:${unit}`)).length
       const recent = history.filter(item=>item.track===route).slice(0,3)
       const examAverage = recent.length ? recent.reduce((sum,item)=>sum+item.score,0)/recent.length : 0
       const coverage = units.length ? mastered/units.length*100 : 0
       return Math.round(recent.length ? coverage*.6+examAverage*.4 : coverage)
      }
      return <section className="analytics-panel panel"><div className="eyebrow">АНАЛИТИКА ОБУЧЕНИЯ</div><h2>Твоя динамика</h2><div className="analytics-summary-grid"><article><small>ЭКЗАМЕНОВ ПРОЙДЕНО</small><b>{history.length}</b></article><article><small>СРЕДНИЙ РЕЗУЛЬТАТ</small><b>{history.length ? `${avg}%` : '—'}</b></article><article><small>ЛУЧШИЙ РЕЗУЛЬТАТ</small><b>{history.length ? `${best}%` : '—'}</b></article><article><small>СОХРАНЁННЫХ ОШИБОК</small><b>{(saved.mistakes ?? []).length}</b></article></div>
       <h3>Результаты по направлениям</h3><div className="analytics-track-list">{byTrack.map(item=><div className="analytics-track" key={item.id}><b>{item.id==='base'?'Базовый курс':item.id==='oge'?'ОГЭ':'ЕГЭ'}</b><span>{item.count ? `${item.count} попыток · средний ${item.avg}% · лучший ${item.best}%` : 'Экзамены ещё не сдавались'}</span><div className="progress-track"><span style={{width:`${item.avg}%`}}/></div></div>)}</div>
       <h3>История последних экзаменов</h3>{history.length===0 ? <p className="analytics-empty">После первого экзамена здесь появятся результаты и динамика.</p> : <div className="exam-history-list">{history.slice(0,10).map(item=><article key={item.id}><div><b>{item.track==='base'?'Базовый курс':item.track==='oge'?'ОГЭ':'ЕГЭ'} · {item.kind==='topic' ? item.topic : 'Полный вариант'}</b><small>{new Date(item.completedAt).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'})} · {item.correct}/{item.total} верно</small></div><strong>{item.score}%</strong></article>)}</div>}
       <h3>Ориентировочная готовность по направлениям</h3><p className="analytics-empty">Это учебный индикатор, а не официальный прогноз результата экзамена. Он учитывает освоенные темы и последние попытки.</p><div className="analytics-track-list">{(['base','oge','ege'] as const).map(id=>{const route=tracks.find(item=>item.id===id)!;const value=readiness(id);return <div className="analytics-track" key={id}><b>{route.name}</b><span>{value}% · {value>=80?'хорошая учебная база':value>=50?'есть темы для повторения':'нужно укрепить фундамент'}</span><div className="progress-track"><span style={{width:`${value}%`}}/></div></div>})}</div>
       <h3>Персональные рекомендации</h3><div className="recommendation-list">{weak.flatMap(route=>route.mistakes.slice(0,3).map(mistake=>({...mistake,routeName:route.name}))).slice(0,5).map(item=><article key={item.id}><div><b>{item.title}</b><small>{item.routeName} · повторялась ошибка: {item.attempts} раз(а)</small><p>{item.rationale}</p></div><button className="primary-btn" onClick={()=>{const mapped=independentExamBank.find(question=>question.title===item.title)?.unit;const valid=tracks.find(route=>route.id===item.track)?.lessons.some(lesson=>lesson.unit===item.unit);const topic=valid?item.unit:(mapped??'');if(topic){setExamTrack(item.track);setSelectedTopic(topic);startExam(item.track,Date.now()%100000,'topic',topic)}else{setNotice('Для этой старой записи нет точной привязки к теме. Открой журнал ошибок и выбери тему вручную.')}}}>Потренировать тему →</button></article>)}{(saved.mistakes??[]).length===0&&<p className="analytics-empty">Пока нет ошибок для персональных рекомендаций. После экзамена сайт подберёт темы для повторения.</p>}</div>
       <h3>Где чаще всего встречаются ошибки</h3><div className="analytics-track-list">{weak.map(item=><div className="analytics-track" key={item.id}><b>{item.name}</b><span>{item.mistakes.length} ошибок в журнале</span></div>)}</div>
      </section>
     })()}
     <div className="progress-track-list">{tracks.map(item => <div className="progress-track-card" key={item.id}><span className={'track-icon ' + item.tone}>{item.icon}</span><div><small>{item.short}</small><b>{item.name} · {item.lessons.filter(lesson => saved.done.includes(lesson.id)).length}/{item.lessons.length}</b><div className="progress-track"><span style={{ width: progressByTrack(item.id) + '%' }}/></div></div><strong>{progressByTrack(item.id)}%</strong></div>)}</div>
     <section className="mastery-panel panel"><div className="eyebrow">КАРТА ОСВОЕНИЯ</div><h2>Что ты действительно освоил</h2><p className="mastery-intro">Статус меняется по результатам независимого мини-экзамена, а не только после чтения урока.</p><div className="mastery-legend"><span className="mastery-pill status-studied">Изучено</span><span className="mastery-pill status-reinforced">Закреплено</span><span className="mastery-pill status-mastered">Освоено</span></div><div className="mastery-unit-list">{tracks.map(route => [...new Set(route.lessons.map(lesson => lesson.unit))].map(unit => { const key = `${route.id}:${unit}`; const lessons = route.lessons.filter(lesson => lesson.unit === unit); const studied = lessons.filter(lesson => saved.done.includes(lesson.id)).length; const mastered = (saved.masteredUnits ?? []).includes(key); const reinforced = (saved.passedUnits ?? []).includes(key); const status = mastered ? 'mastered' : reinforced ? 'reinforced' : studied > 0 ? 'studied' : 'not-started'; const label = mastered ? 'Освоено' : reinforced ? 'Закреплено' : studied > 0 ? 'Изучено' : 'Не начато'; return <article className="mastery-unit" key={key}><div className="mastery-unit-main"><div><small>{route.name}</small><b>{unit}</b><span>{studied} из {lessons.length} уроков завершено</span></div><span className={`mastery-pill status-${status}`}>{label}</span></div><div className="mastery-progress"><span style={{ width: `${Math.round(studied * 100 / Math.max(1, lessons.length))}%` }}/></div>{reinforced && <small className="mastery-result">Экзамен: {mastered ? '85% или выше' : 'не менее 67%'}</small>}</article> }))}</div></section>
     <section className="mistakes-panel panel"><div className="eyebrow">АДАПТИВНОЕ ПОВТОРЕНИЕ</div><h2>Мои ошибки</h2><div className="mistake-action-bar"><div><b>Сформировать тренировку по слабым темам</b><small>Подберём тематический вариант по сохранённым ошибкам и направлению.</small></div><button className="primary-btn" disabled={(saved.mistakes??[]).length===0} onClick={()=>{const top=[...(saved.mistakes??[])].sort((a,b)=>b.attempts-a.attempts||b.lastAt-a.lastAt)[0];if(top){const mapped=independentExamBank.find(question=>question.title===top.title)?.unit;const valid=tracks.find(route=>route.id===top.track)?.lessons.some(lesson=>lesson.unit===top.unit);const topic=valid?top.unit:(mapped??'');if(topic){setExamTrack(top.track);setSelectedTopic(topic);startExam(top.track,Date.now()%100000,'topic',topic)}else setNotice('Для этой старой записи нет точной привязки к теме. Выбери тему в разделе экзаменов.')}}}>Начать повторение →</button></div><p className="mastery-intro">Неверные ответы из независимых экзаменов сохраняются здесь. Повторяй не тот же ответ, а правило и объяснение ошибки.</p>{(saved.mistakes ?? []).length === 0 ? <div className="mistakes-empty">Пока нет сохранённых ошибок. После первого экзамена здесь появятся задания, в которых понадобилось больше внимания.</div> : <><div className="mistakes-summary"><b>{(saved.mistakes ?? []).length}</b><span>сохранённых ошибок</span><small>Повторные ошибки отмечаются счётчиком попыток.</small></div><div className="mistakes-list">{(saved.mistakes ?? []).slice(0, 30).map(mistake => <article className="mistake-item" key={mistake.id}><div className="mistake-item-head"><span>{mistake.track.toUpperCase()} · {mistake.unit}</span><small>Попыток: {mistake.attempts}</small></div><b>{mistake.title}</b><p>{mistake.question}</p><div className="mistake-answer wrong">Твой ответ: {mistake.wrongAnswer}</div><div className="mistake-answer right">Правильный ответ: {mistake.correctAnswer}</div><small className="mistake-rationale">{mistake.rationale}</small><button className="mistake-remove" onClick={() => setSaved(value => ({ ...value, mistakes: (value.mistakes ?? []).filter(item => item.id !== mistake.id) }))}>Убрать из списка после повторения</button></article>)}</div></>}</section>
     <div className="progress-note-card"><span>✧</span><div><b>{saved.lastScore === null ? 'Первый полный пробник ещё впереди' : `Последний результат автопроверки: ${saved.lastScore}%`}</b><p>Письменные ответы проверяй отдельно по критериям, которые появятся в конце варианта.</p></div><button onClick={() => go('exams')}>К вариантам →</button></div>
    </>}
    {view === 'settings' && <>
     <PageTitle eyebrow="НАСТРОЙКИ" title="Твоё учебное пространство" subtitle="Настрой профиль, установи приложение и управляй резервными копиями прогресса."/>
     <div className="settings-layout"><section className="settings-card panel"><div className="eyebrow">ПРОФИЛЬ</div><h2>Настройки профиля</h2><div className="profile-editor"><div className="avatar-preview-wrap"><div className="avatar-preview">{saved.avatar ? <img src={saved.avatar} alt="Предпросмотр аватара" style={{ objectPosition: `${saved.avatarX ?? 50}% ${saved.avatarY ?? 50}%`, transform: `scale(${(saved.avatarZoom ?? 120) / 100})` }}/> : <span>{saved.name.trim()[0]?.toUpperCase() || 'У'}</span>}</div><small>Предпросмотр аватара</small></div><div className="avatar-tools"><label className="setting-field">Имя в приложении<input value={saved.name} maxLength={28} placeholder="Введите имя" onChange={event => setSaved(value => ({ ...value, name: event.target.value }))} onBlur={() => setSaved(value => ({ ...value, name: value.name.trim() || 'Ученик' }))}/></label><div className="avatar-upload-actions"><label className="avatar-upload-btn">Выбрать фото или файл<input type="file" accept="image/*" onChange={handleAvatarChange}/></label><label className="avatar-upload-btn secondary">Сфотографировать<input type="file" accept="image/*" capture="environment" onChange={handleAvatarChange}/></label>{saved.avatar && <button className="avatar-remove-btn" onClick={() => setSaved(value => ({ ...value, avatar: '' }))}>Удалить фото</button>}</div></div></div><div className="settings-divider"/><div className="setting-row"><div><b>Тёмная тема</b><small>Комфортный контраст для занятий вечером.</small></div><button className={'switch ' + (saved.theme === 'dark' ? 'on' : '')} onClick={() => setSaved(value => ({ ...value, theme: value.theme === 'dark' ? 'light' : 'dark' }))}><span/></button></div><div className="settings-divider"/><div className="setting-row"><div><b>Состояние подключения</b><small>{isOnline ? 'Интернет доступен. Данные продолжают сохраняться на этом устройстве.' : 'Нет интернета. Доступны закешированные разделы; новые внешние материалы могут не загрузиться.'}</small></div><span className="local-badge">{isOnline ? '● В сети' : '● Офлайн'}</span></div><div className="settings-divider"/><section className="backup-tools"><div className="eyebrow">РЕЗЕРВНАЯ КОПИЯ</div><h3>Перенос прогресса на другое устройство</h3><p>Скачай файл копии, отправь его себе по почте или через мессенджер, затем импортируй на другом устройстве. Импорт заменяет текущие локальные данные.</p><div className="backup-actions"><button className="primary-btn" onClick={exportBackup}>Скачать резервную копию</button><label className="avatar-upload-btn backup-import">Импортировать копию<input type="file" accept="application/json,.json" onChange={importBackup}/></label></div><small>Файл содержит имя, настройки, учебный прогресс, результаты, журнал ошибок и фото профиля. Храни его в личном безопасном месте.</small></section><div className="settings-divider"/><section className="backup-tools"><div className="eyebrow">РАБОТА БЕЗ ИНТЕРНЕТА</div><h3>Установка приложения</h3><p>Открой сайт онлайн хотя бы один раз и дождись загрузки. На iPhone: Safari → «Поделиться» → «На экран Домой». На Android: меню Chrome → «Установить приложение» или «Добавить на главный экран». На компьютере: нажми значок установки в адресной строке Chrome или Edge. Офлайн-доступ зависит от того, какие материалы уже были загружены.</p><small>Распознавание фото (OCR), внешние ссылки и загрузка языковой модели могут требовать интернет, особенно при первом запуске.</small></section><div className="settings-divider"/><section className="backup-tools cloud-sync-tools"><div className="eyebrow">ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ</div><h3>Один профиль на всех устройствах</h3><p>Войди с одной и той же почтой на телефоне и компьютере. Прогресс и фото профиля будут сохраняться в облаке после изменений. Если два устройства одновременно меняют данные, последнее сохранение может заменить более раннее.</p>{!cloudReadyConfig ? <div className="cloud-config-warning">Облачный сервис пока не подключён владельцем сайта. После настройки Supabase здесь появятся вход и регистрация.</div> : cloudSession ? <><div className="cloud-account"><b>{cloudSession.user.email || 'Аккаунт подключён'}</b><span>{cloudStatus}</span></div><button className="secondary-btn" onClick={cloudLogout}>Выйти из облачного аккаунта на этом устройстве</button></> : <><label className="setting-field">Электронная почта<input type="email" autoComplete="email" value={cloudEmail} onChange={event=>setCloudEmail(event.target.value)} placeholder="name@example.com"/></label><label className="setting-field">Пароль<input type="password" autoComplete="current-password" value={cloudPassword} onChange={event=>setCloudPassword(event.target.value)} placeholder="Не менее 8 символов"/></label><div className="backup-actions"><button className="primary-btn" disabled={cloudBusy} onClick={()=>cloudAuth('login')}>{cloudBusy?'Подключение…':'Войти'}</button><button className="secondary-btn" disabled={cloudBusy} onClick={()=>cloudAuth('signup')}>Создать аккаунт</button></div><small>{cloudStatus}. Используй личную почту и уникальный пароль. Не используй пароль от своей почты.</small></>}</section><div className="settings-divider"/><button className="reset-button" onClick={() => { if (confirm('Сбросить весь прогресс на этом устройстве?')) { localStorage.removeItem(storageKey); setSaved(initial); setView('home') } }}>Сбросить прогресс</button></section><div className="settings-about"><div className="book-emblem">Я<small>ё</small></div><div className="eyebrow">РУССКИЙ ЯСНО</div><h3>Грамотность<br/>без запинки.</h3><p>100 уроков от школьной грамматики до экзаменационных заданий. По проекту ОГЭ-2027 пояснение каждого примера обязательно: СК2 — до 4 баллов, сочинение — до 8, вся работа — до 38. В ЕГЭ по русскому языку изменений на 2027 год не заявлено. Варианты сайта — авторская практика, не официальные КИМ.</p><div className="fipi-links"><small>ПРОЕКТЫ КИМ 2027 И ДОКУМЕНТЫ ФИПИ</small><a href={officialSources.oge} target="_blank" rel="noreferrer">ОГЭ · демоверсии и спецификация ↗</a><a href={officialSources.ogeChanges} target="_blank" rel="noreferrer">ОГЭ · изменения проекта 2027 ↗</a><a href={officialSources.ege} target="_blank" rel="noreferrer">ЕГЭ · демоверсии и спецификация ↗</a><a href={officialSources.egeChanges} target="_blank" rel="noreferrer">ЕГЭ · изменения проекта 2027 ↗</a></div></div></div>
    </>}
   </div>
   <footer className="footer"><span>РУССКИЙ ЯСНО <i>·</i> УЧИМСЯ ПОНИМАТЬ ПРАВИЛА</span><span>ОБЪЯСНИ. ПРИМЕНИ. ЗАПОМНИ. <b>✦</b></span></footer>
  </main>
  {avatarEditorOpen && saved.avatar && <div className="avatar-editor-backdrop" role="dialog" aria-modal="true" aria-label="Настройка фотографии" onMouseDown={event => { if (event.target === event.currentTarget) setAvatarEditorOpen(false) }}><section className="avatar-editor-modal"><div className="avatar-editor-head"><div><div className="eyebrow">НАСТРОЙКА АВАТАРА</div><h2>Подгони фотографию</h2><p>Перемещай изображение по горизонтали и вертикали, а также меняй масштаб. Настройки доступны только в этом окне.</p></div><button className="button-quiet" aria-label="Закрыть" onClick={() => setAvatarEditorOpen(false)}>×</button></div><div className="avatar-editor-preview"><div className="avatar-editor-circle"><img src={saved.avatar} alt="Предпросмотр аватара" style={{ objectPosition: `${saved.avatarX ?? 50}% ${saved.avatarY ?? 50}%`, transform: `scale(${(saved.avatarZoom ?? 100) / 100})` }}/></div><small>Предпросмотр в круглой рамке профиля</small></div><div className="avatar-editor-controls"><label><span>Горизонтальное положение</span><b>{saved.avatarX ?? 50}%</b><input type="range" min="0" max="100" value={saved.avatarX ?? 50} onChange={event => setSaved(value => ({ ...value, avatarX: Number(event.target.value) }))}/></label><label><span>Вертикальное положение</span><b>{saved.avatarY ?? 50}%</b><input type="range" min="0" max="100" value={saved.avatarY ?? 50} onChange={event => setSaved(value => ({ ...value, avatarY: Number(event.target.value) }))}/></label><label><span>Масштаб</span><b>{saved.avatarZoom ?? 100}%</b><input type="range" min="100" max="250" value={saved.avatarZoom ?? 120} onChange={event => setSaved(value => ({ ...value, avatarZoom: Number(event.target.value) }))}/></label></div><div className="avatar-editor-actions"><button className="button-quiet" onClick={() => setSaved(value => ({ ...value, avatarX: 50, avatarY: 50, avatarZoom: 120 }))}>Сбросить кадрирование</button><button className="primary-btn" onClick={() => setAvatarEditorOpen(false)}>Сохранить фотографию</button></div></section></div>}
 </div>
}

function PageTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <div className="page-title"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div> }
function PracticeResult({ text, expected, mode, rule }: { text: string; expected: string; mode: PracticeMode; rule: string }) {
 const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/[«»„“]/g, '"').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim()
 const equal = normalize(text) === normalize(expected)
 const original = expected.match(/[А-Яа-яЁё0-9]+|[^А-Яа-яЁё0-9]+/g) ?? []
 const entered = text.match(/[А-Яа-яЁё0-9]+|[^А-Яа-яЁё0-9]+/g) ?? []
 const differences = original.flatMap((token, index) => normalize(token) === normalize(entered[index] ?? '') ? [] : [{ expected: token, entered: entered[index] ?? '—', index: index + 1 }]).slice(0, 10)
 return <div className={'check-result ' + (equal ? 'success' : 'needs-work')}><div className="result-heading"><span>{equal ? '✓' : '↻'}</span><div><b>{equal ? 'Точно. Ответ совпал с образцом.' : 'Есть расхождения — разберём по словам.'}</b><small>{equal ? 'Отлично! Теперь проговори правило вслух.' : 'OCR может ошибиться при чтении почерка; сначала проверь распознанный текст.'}</small></div></div>{!equal && <div className="diff-lines">{differences.length ? differences.map(item => <p key={item.index}><small>ФРАГМЕНТ {item.index}</small><br/>У тебя: <b>{item.entered}</b><br/>В образце: <b>{item.expected}</b></p>) : <p>Тексты различаются по длине или знакам. Сверь весь ответ с образцом.</p>}</div>}<div className="rule-box"><span>✓</span><p><b>ПОЧЕМУ</b>{rule}</p></div><p className="result-tip">{mode === 'punctuation' ? 'Для каждого знака назови конструкцию и синтаксическое основание.' : mode === 'spelling' ? 'Для каждой трудной буквы назови морфему и условие правила.' : 'Повтори слова и знаки, в которых сомневался.'}</p></div>
}
function ExamSession({ task, index, total, progress, answer, written, selectedPrompt, timeLeft, answers, writtenAnswers, tasks, onJump, onAnswer, onWrite, onSelectPrompt, onBack, onNext, onExit, onSpeak }: { task: ExamTask; index: number; total: number; progress: number; answer: number; written: string; selectedPrompt: number; timeLeft: number; answers: number[]; writtenAnswers: Record<number,string>; tasks: ExamTask[]; onJump: (index:number)=>void; onAnswer: (value: number) => void; onWrite: (value: string) => void; onSelectPrompt: (value: number) => void; onBack: () => void; onNext: () => void; onExit: () => void; onSpeak: (text: string) => void }) {
 const visibleSource = task.kind === 'writing' && task.sourceText && !task.hideSource
 return <section className="exam-session panel"><div className="exam-session-top"><div><div className="eyebrow">{task.kind === 'writing' ? 'ПИСЬМЕННАЯ ЧАСТЬ' : `ЗАДАНИЕ ${task.number}`} · {String(index + 1).padStart(2, '0')}/{total}</div><h2>{task.title}</h2></div><div className="exam-time">◷ {formatClock(timeLeft)}</div><button className="exit-exam" onClick={onExit}>Выйти из варианта ×</button></div><div className="exam-progress-row"><span>ПРОГРЕСС ВАРИАНТА</span><span>{progress}%</span></div><div className="progress-track"><span style={{ width: progress + '%' }}/></div>
  <div className="exam-nav-head"><b>НАВИГАЦИЯ ПО ЗАДАНИЯМ</b><span>{tasks.reduce((count,item,i)=>count+(item.kind==='choice' ? (answers[i]!==-1 ? 1 : 0) : (writtenAnswers[item.number]?.trim() ? 1 : 0)),0)} / {total} заполнено</span></div><div className="exam-question-nav">{tasks.map((item,i)=>{const done=item.kind==='choice'?answers[i]!==-1:Boolean(writtenAnswers[item.number]?.trim());return <button type="button" key={item.id} aria-label={`Перейти к заданию ${i+1}`} aria-current={i===index?'step':undefined} className={(i===index?'current ':'')+(done?'answered':'')+(item.kind==='writing'?' writing':'')} onClick={()=>onJump(i)}>{i+1}</button>})}</div><div className="exam-nav-legend"><span><i className="current-dot"/> Текущее</span><span><i className="done-dot"/> Заполнено</span><span><i className="empty-dot"/> Не заполнено</span></div>
  {task.kind === 'choice' ? <><h3 className="exam-question">{task.question}</h3><div className="exam-options">{task.choices.map((choice, option) => <button key={choice} className={answer === option ? 'answer-option chosen' : 'answer-option'} onClick={() => onAnswer(option)}><span className="option-letter">{'АБВ'[option]}</span>{choice}</button>)}</div></> : <div className="exam-writing"><p className="exam-instructions">{task.instructions}</p>{task.hideSource && task.sourceText && <div className="exam-audio"><span>Часть 1 · прослушай исходный текст</span><button onClick={() => onSpeak(task.sourceText!)}>▶ Прослушать текст</button><small>Повторное воспроизведение доступно как учебная функция.</small></div>}{visibleSource && <div className="exam-source"><div className="eyebrow">ИСХОДНЫЙ ТЕКСТ</div><p>{task.sourceText}</p></div>}{task.promptOptions && <div className="essay-prompts">{task.promptOptions.map((prompt, promptIndex) => <button key={prompt} className={selectedPrompt === promptIndex ? 'prompt-choice selected' : 'prompt-choice'} onClick={() => onSelectPrompt(promptIndex)}>{prompt}</button>)}</div>}<label className="write-label">ТВОЯ РАБОТА · {wordCount(written)} СЛОВ<textarea value={written} onChange={event => onWrite(event.target.value)} placeholder={task.hideSource ? 'Запиши сжатое изложение…' : 'Напиши связный ответ здесь…'} rows={9}/></label><div className="exam-rubric"><b>Проверь себя перед сдачей</b>{task.rubric.map(point => <label key={point}><input type="checkbox"/> {point}</label>)}<small>Минимальный ориентир: {task.minWords} слов. Письменная часть не оценивается автоматикой.</small></div></div>}
  <div className="exam-controls"><button className="button-quiet" disabled={index === 0} onClick={onBack}>← Назад</button><button className="primary-btn" onClick={onNext}>{index === total - 1 ? 'Завершить вариант и увидеть разбор' : 'Сохранить и продолжить →'}</button></div>
 </section>
}
function ExamResult({ score, tasks, answers, written, onClose, onRetry }: { score: number; tasks: ExamTask[]; answers: number[]; written: Record<number, string>; onClose: () => void; onRetry: () => void }) {
 const objective = tasks.filter((task): task is ChoiceTask => task.kind === 'choice')
 const correct = tasks.reduce((sum, task, index) => sum + (task.kind === 'choice' && answers[index] === task.correct ? 1 : 0), 0)
 const writings = tasks.filter((task): task is WritingTask => task.kind === 'writing')
 const [checkedCriteria, setCheckedCriteria] = useState<Record<string, boolean[]>>({})
 const [expandedWork, setExpandedWork] = useState<Record<string, boolean>>({})
 return <section className="exam-result panel"><div className="result-medal">{score >= 70 ? '✦' : '↗'}</div><div className="eyebrow">ВАРИАНТ ЗАВЕРШЁН</div><h2>{score >= 70 ? 'Хорошая основа. Разбери оставшиеся ошибки.' : 'Теперь видно, что повторить.'}</h2><div className="score-value">{score}<small>%</small></div><p>Автоматически проверены тестовые задания: {correct} из {objective.length}. Письменные работы не включены в этот процент: для объективной оценки их нужно проверить по критериям.</p>
 {writings.length > 0 && <div className="written-summary"><h3>Проверка письменной работы</h3><p>Отметь только те критерии, которым твой текст действительно соответствует. Это чек-лист самопроверки, а не автоматическая экспертная оценка.</p>{writings.map(task => {
  const text = written[task.number] ?? ''
  const words = wordCount(text)
  const checks = checkedCriteria[task.id] ?? task.rubric.map(() => false)
  const done = checks.filter(Boolean).length
  const expanded = expandedWork[task.id] ?? false
  return <article key={task.id} className="writing-review-card">
   <b>Задание {task.number} · {task.title}</b>
   <div className="writing-review-meta"><span>{words} слов</span><span>Минимум: {task.minWords}</span><span>{done}/{task.rubric.length} критериев</span></div>
   <div className="progress-track"><span style={{width: `${task.rubric.length ? done / task.rubric.length * 100 : 0}%`}}/></div>
   {words < task.minWords && <p className="writing-warning">Объём ниже минимального ориентира. Дополни работу и проверь, что новые предложения развивают мысль.</p>}
   <button className="button-quiet" onClick={() => setExpandedWork(value => ({...value, [task.id]: !expanded}))}>{expanded ? 'Скрыть текст работы' : 'Показать мой текст'}</button>
   {expanded && <pre className="writing-submitted-text">{text || 'Ответ не написан.'}</pre>}
   <div className="writing-checklist">{task.rubric.map((point, index) => <label key={point}><input type="checkbox" checked={Boolean(checks[index])} onChange={event => setCheckedCriteria(value => ({...value, [task.id]: task.rubric.map((_, i) => i === index ? event.target.checked : Boolean((value[task.id] ?? [])[i]))}))}/> {point}</label>)}</div>
   <small>Самопроверка: {done === task.rubric.length && words >= task.minWords ? 'все пункты отмечены — при необходимости попроси преподавателя проверить работу' : 'проверь каждый пункт и исправь недочёты'}</small>
  </article>
 })}</div>}
 <div className="answer-review">{tasks.filter(task => task.kind === 'choice').map(task => { const choice = task as ChoiceTask; const taskIndex = tasks.indexOf(task); return <div className="review-row" key={task.id}><span className={answers[taskIndex] === choice.correct ? 'review-ok' : 'review-no'}>{answers[taskIndex] === choice.correct ? '✓' : '×'}</span><div><b>Задание {choice.number} · {choice.title}</b><small>{choice.question}</small><em>{answers[taskIndex] === choice.correct ? 'Верно. ' : `Правильный ответ: ${choice.choices[choice.correct]}. `}{choice.rationale}</em></div></div>})}</div><div className="exam-controls"><button className="button-quiet" onClick={onClose}>К экзаменам</button><button className="primary-btn" onClick={onRetry}>Повторить вариант →</button></div></section>
}
export default App
