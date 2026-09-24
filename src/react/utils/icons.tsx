/**
 * SVG icon React components.
 *
 * Backed by lucide-react. Standard icons are re-exported under their original
 * *Svg names so existing imports continue to work unchanged.
 *
 * Icons not available in lucide (Broom/PlayFill) retain hand-written SVG.
 */

import React from "react";
import type { LucideProps } from "lucide-react";
import {
  Palette,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BarChart,
  Book,
  BookOpen,
  Scale,
  Bot,
  Brain,
  Calendar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  CircleDollarSign,
  Clock,
  Code,
  Copy,
  CopyCheck,
  CopyPlus,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  FileUp,
  Filter,
  FlaskConical,
  Folder,
  Globe,
  Grid2X2,
  GripVertical,
  Heart,
  History,
  House,
  Image,
  Info,
  Layers,
  Lightbulb,
  Link,
  List,
  MessageSquare,
  MessageSquareShare,
  MessagesSquare,
  Microscope,
  Maximize2,
  Minus,
  MoreHorizontal,
  MoreVertical,
  Network,
  Newspaper,
  PanelLeft,
  PanelRight,
  Pause,
  Paperclip,
  Pencil,
  Pin,
  Play,
  PlayCircle,
  Plus,
  Quote,
  RefreshCcw,
  Rss,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  StopCircle,
  Tag,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash,
  Trash2,
  TrendingDown,
  TrendingUp,
  Undo,
  Upload,
  User,
  Webhook,
  X,
  Zap,
  Loader2,
} from "lucide-react";

// ── Custom fallbacks (not in lucide 0.469) ────────────────────────

/** Broom (lucide 0.469 has no Broom icon). */
export const BroomIconSvg: React.FC<LucideProps> = ({
  size = 16,
  color,
  className,
  style,
  ...rest
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color || "currentColor"}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{
      display: "inline-block",
      verticalAlign: "middle",
      flexShrink: 0,
      ...style,
    }}
    {...rest}
  >
    <path d="m18 7 4 2-4 2" />
    <path d="m18 13 4-2-4-2" />
    <path d="m3 7 4 2-4 2" />
    <path d="m3 13 4-2-4-2" />
    <path d="M7 5v14" />
    <path d="M3 9a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2Z" />
    <path d="M3 15a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2Z" />
  </svg>
);

/** Filled play triangle (lucide has no fill variant). */
export const PlayFillIconSvg: React.FC<LucideProps> = ({
  size = 16,
  color,
  className,
  style,
  ...rest
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color || "currentColor"}
    stroke="none"
    className={className}
    style={{
      display: "inline-block",
      verticalAlign: "middle",
      flexShrink: 0,
      ...style,
    }}
    {...rest}
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

// ── Backward-compatible re-exports ────────────────────────────────
// Keep the *Svg naming convention so existing imports don't break.

export const HomeIconSvg = House;
export const MessageIconSvg = MessageSquare;
export const DiscussionIconSvg = MessagesSquare;
export const SendIconSvg = Send;
export const UserIconSvg = User;
export const SettingsIconSvg = Settings;
export const RefreshIconSvg = RefreshCcw;
export const ScaleIconSvg = Scale;
export const PaperclipIconSvg = Paperclip;
export const DownloadIconSvg = Download;
export const CopyIconSvg = Copy;
export const TrashIconSvg = Trash;
export const PencilIconSvg = Pencil;
export const NoteIconSvg = FileText;
export const CheckIconSvg = Check;
export const AlertCircleIconSvg = AlertCircle;
export const ChevronDownIconSvg = ChevronDown;
export const ChevronUpIconSvg = ChevronUp;
/* 研究结构批 A1（2026-09-20）：形式②贴边把手 chevron 指向面板移动方向，
   左栏展开态需左向 chevron（ChevronRight 先例补齐左向）。 */
export const ChevronLeftIconSvg = ChevronLeft;
export const MoreVerticalIconSvg = MoreVertical;
export const MoreHorizontalIconSvg = MoreHorizontal;
export const CodeIconSvg = Code;
export const TerminalIconSvg = Terminal;
export const BotIconSvg = Bot;
export const PlayIconSvg = Play;
export const PauseIconSvg = Pause;
export const SearchIconSvg = Search;
export const XIconSvg = X;
export const MinusIconSvg = Minus;
export const SquareIconSvg = Square;
export const PanelLeftIconSvg = PanelLeft;
export const PanelRightIconSvg = PanelRight;
export const PlusIconSvg = Plus;
export const PinIconSvg = Pin;
export const QuoteIconSvg = Quote;
export const ClockIconSvg = Clock;
export const ArrowDownIconSvg = ArrowDown;
export const ArrowLeftIconSvg = ArrowLeft;
/* 砚化第二轮·阅读器面板批（2026-09-20）：翻译面板语向箭头弃字符「→」改 lucide
   （砚法 §5.5 图标法：线性图标 lucide 族，禁混用第二套图标语法）。 */
export const ArrowRightIconSvg = ArrowRight;
export const ChevronRightIconSvg = ChevronRight;
export const FileTextIconSvg = FileText;
export const BrainIconSvg = Brain;
export const BookIconSvg = Book;
export const TagIconSvg = Tag;
export const CircleDollarIconSvg = CircleDollarSign;
export const UndoIconSvg = Undo;
/** §15-105：undoing 单环旋转（OrbitRings 退役后的法定旋转例外）。 */
export const LoaderIconSvg = Loader2;
export const ShieldIconSvg = Shield;
export const ShieldCheckIconSvg = ShieldCheck;
export const CheckCircleIconSvg = CheckCircle;
export const FolderIconSvg = Folder;
export const ImportIconSvg = Upload;
export const FileDownIconSvg = FileDown;
export const FlaskIconSvg = FlaskConical;
export const MicroscopeIconSvg = Microscope;
export const GlobeIconSvg = Globe;
export const NewspaperIconSvg = Newspaper;
export const RssIconSvg = Rss;
export const SparklesIconSvg = Sparkles;
export const PaletteIconSvg = Palette;
export const ImageIconSvg = Image;
export const FileUpIconSvg = FileUp;
export const PlayCircleIconSvg = PlayCircle;
export const TrashCanIconSvg = Trash2;
export const EyeIconSvg = Eye;
export const EyeOffIconSvg = EyeOff;
export const StopCircleIconSvg = StopCircle;
export const FunnelIconSvg = Filter;
export const CopyPlusIconSvg = CopyPlus;
export const BookOpenIconSvg = BookOpen;
export const LayersIconSvg = Layers;
export const BarChartIconSvg = BarChart;
export const LightbulbIconSvg = Lightbulb;
export const ShareNetworkIconSvg = MessageSquareShare;
export const NetworkIconSvg = Network;
export const GridViewIconSvg = Grid2X2;
export const ListViewIconSvg = List;
// 首页页批（2026-09-20 IA 附法 §4.1）：bento 卡编辑态拖拽把手（砚法卡头 grip 位）。
export const GripVerticalIconSvg = GripVertical;
export const ChatBubbleIconSvg = MessageSquare;
export const BoltIconSvg = Zap;
export const InfoIconSvg = Info;
export const AlertTriangleIconSvg = AlertTriangle;
export const ExternalLinkIconSvg = ExternalLink;
export const LinkIconSvg = Link;
export const CalendarIconSvg = Calendar;
export const TrendingUpIconSvg = TrendingUp;
export const TrendingDownIconSvg = TrendingDown;
export const DatabaseIconSvg = Database;
export const HistoryIconSvg = History;
export const StarIconSvg = Star;
export const HeartIconSvg = Heart;
export const ThumbsUpIconSvg = ThumbsUp;
export const ThumbsDownIconSvg = ThumbsDown;
export const WebhookIconSvg = Webhook;
export const Share2IconSvg = Share2;
export const CopyCheckIconSvg = CopyCheck;
export const ChevronsLeftIconSvg = ChevronsLeft;
export const ChevronsRightIconSvg = ChevronsRight;
export const Maximize2IconSvg = Maximize2;
export const CircleHelpIconSvg = CircleHelp;

// ── Icon name → component registry ────────────────────────────────

// 键集即 IconName 联合类型（2026-09-07 W1-3）：name 用字面量联合在编译期
// 拦截断链——曾因 Record<string> + MessageIconSvg 兜底把缺 home/playFill
// 键吞成静默错图标（HomeIcon 渲染成消息方框）。
const iconRegistry = {
  message: MessageIconSvg,
  send: SendIconSvg,
  user: UserIconSvg,
  settings: SettingsIconSvg,
  refresh: RefreshIconSvg,
  paperclip: PaperclipIconSvg,
  download: DownloadIconSvg,
  copy: CopyIconSvg,
  trash: TrashIconSvg,
  pencil: PencilIconSvg,
  note: NoteIconSvg,
  check: CheckIconSvg,
  alertCircle: AlertCircleIconSvg,
  chevronDown: ChevronDownIconSvg,
  chevronUp: ChevronUpIconSvg,
  moreVertical: MoreVerticalIconSvg,
  moreHorizontal: MoreHorizontalIconSvg,
  code: CodeIconSvg,
  terminal: TerminalIconSvg,
  bot: BotIconSvg,
  play: PlayIconSvg,
  pause: PauseIconSvg,
  search: SearchIconSvg,
  x: XIconSvg,
  minus: MinusIconSvg,
  square: SquareIconSvg,
  panelLeft: PanelLeftIconSvg,
  panelRight: PanelRightIconSvg,
  plus: PlusIconSvg,
  pin: PinIconSvg,
  quote: QuoteIconSvg,
  chatBubble: ChatBubbleIconSvg,
  clock: ClockIconSvg,
  arrowDown: ArrowDownIconSvg,
  arrowLeft: ArrowLeftIconSvg,
  arrowRight: ArrowRightIconSvg,
  chevronRight: ChevronRightIconSvg,
  fileText: FileTextIconSvg,
  brain: BrainIconSvg,
  book: BookIconSvg,
  tag: TagIconSvg,
  undo: UndoIconSvg,
  shield: ShieldIconSvg,
  shieldCheck: ShieldCheckIconSvg,
  checkCircle: CheckCircleIconSvg,
  import: ImportIconSvg,
  fileDown: FileDownIconSvg,
  flask: FlaskIconSvg,
  microscope: MicroscopeIconSvg,
  globe: GlobeIconSvg,
  newspaper: NewspaperIconSvg,
  rss: RssIconSvg,
  sparkles: SparklesIconSvg,
  image: ImageIconSvg,
  fileUp: FileUpIconSvg,
  broom: BroomIconSvg,
  playCircle: PlayCircleIconSvg,
  trashCan: TrashCanIconSvg,
  folder: FolderIconSvg,
  barChart: BarChartIconSvg,
  lightbulb: LightbulbIconSvg,
  shareNetwork: ShareNetworkIconSvg,
  network: NetworkIconSvg,
  gridView: GridViewIconSvg,
  listView: ListViewIconSvg,
  stopCircle: StopCircleIconSvg,
  funnel: FunnelIconSvg,
  copyPlus: CopyPlusIconSvg,
  bookOpen: BookOpenIconSvg,
  layers: LayersIconSvg,
  circleDollar: CircleDollarIconSvg,
  info: InfoIconSvg,
  alertTriangle: AlertTriangleIconSvg,
  externalLink: ExternalLinkIconSvg,
  link: LinkIconSvg,
  calendar: CalendarIconSvg,
  trendingUp: TrendingUpIconSvg,
  trendingDown: TrendingDownIconSvg,
  database: DatabaseIconSvg,
  history: HistoryIconSvg,
  star: StarIconSvg,
  heart: HeartIconSvg,
  thumbsUp: ThumbsUpIconSvg,
  thumbsDown: ThumbsDownIconSvg,
  share2: Share2IconSvg,
  copyCheck: CopyCheckIconSvg,
  home: HomeIconSvg,
  playFill: PlayFillIconSvg,
  bolt: BoltIconSvg,
};

// ── Public API ────────────────────────────────────────────────────

export type IconName = keyof typeof iconRegistry;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
  /** 装饰性图标对读屏隐藏（默认 false，由调用方声明语义） */
  "aria-hidden"?: boolean | "true" | "false";
  /** 有语义的图标提供可读名（自动补 role="img"） */
  "aria-label"?: string;
}

/**
 * Render an icon by name. name 受 IconName 联合约束，无运行时兜底。
 */
export function Icon({
  name,
  size = 16,
  className,
  style,
  color,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  const Component = iconRegistry[name];
  return (
    <Component
      size={size}
      color={color}
      className={className}
      style={style}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? "img" : undefined}
    />
  );
}

// ── Convenience wrappers ──────────────────────────────────────────

type ConvenienceProps = Omit<IconProps, "name">;

export function UserIcon(p: ConvenienceProps) {
  return <Icon name="user" {...p} />;
}
export function BotIcon(p: ConvenienceProps) {
  return <Icon name="bot" {...p} />;
}
export function AlertIcon(p: ConvenienceProps) {
  return <Icon name="alertCircle" {...p} />;
}
export function SendIcon(p: ConvenienceProps) {
  return <Icon name="send" {...p} />;
}
export function StopIcon(p: ConvenienceProps) {
  return <Icon name="square" {...p} />;
}
export function CopyIcon(p: ConvenienceProps) {
  return <Icon name="copy" {...p} />;
}
export function EditIcon(p: ConvenienceProps) {
  return <Icon name="pencil" {...p} />;
}
export function TrashIcon(p: ConvenienceProps) {
  return <Icon name="trash" {...p} />;
}
export function SearchIcon(p: ConvenienceProps) {
  return <Icon name="search" {...p} />;
}
export function PaperclipIcon(p: ConvenienceProps) {
  return <Icon name="paperclip" {...p} />;
}
export function CloseIcon(p: ConvenienceProps) {
  return <Icon name="x" {...p} />;
}
export function ChevronDownIcon(p: ConvenienceProps) {
  return <Icon name="chevronDown" {...p} />;
}
export function ChevronUpIcon(p: ConvenienceProps) {
  return <Icon name="chevronUp" {...p} />;
}
export function SettingsIcon(p: ConvenienceProps) {
  return <Icon name="settings" {...p} />;
}
export function PlusIcon(p: ConvenienceProps) {
  return <Icon name="plus" {...p} />;
}
export function PinIcon(p: ConvenienceProps) {
  return <Icon name="pin" {...p} />;
}
export function NoteIcon(p: ConvenienceProps) {
  return <Icon name="note" {...p} />;
}
export function QuoteIcon(p: ConvenienceProps) {
  return <Icon name="quote" {...p} />;
}
export function RefreshIcon(p: ConvenienceProps) {
  return <Icon name="refresh" {...p} />;
}
export function PanelLeftIcon(p: ConvenienceProps) {
  return <Icon name="panelLeft" {...p} />;
}
export function PanelRightIcon(p: ConvenienceProps) {
  return <Icon name="panelRight" {...p} />;
}
export function CheckIcon(p: ConvenienceProps) {
  return <Icon name="check" {...p} />;
}
export function DownloadIcon(p: ConvenienceProps) {
  return <Icon name="download" {...p} />;
}
export function BoltIcon(p: ConvenienceProps) {
  return <Icon name="bolt" {...p} />;
}
export function CodeIcon(p: ConvenienceProps) {
  return <Icon name="code" {...p} />;
}
export function MoreVerticalIcon(p: ConvenienceProps) {
  return <Icon name="moreVertical" {...p} />;
}
export function MoreHorizontalIcon(p: ConvenienceProps) {
  return <Icon name="moreHorizontal" {...p} />;
}
export function TerminalIcon(p: ConvenienceProps) {
  return <Icon name="terminal" {...p} />;
}
export function MinusIcon(p: ConvenienceProps) {
  return <Icon name="minus" {...p} />;
}
export function PlayIcon(p: ConvenienceProps) {
  return <Icon name="play" {...p} />;
}
export function PauseIcon(p: ConvenienceProps) {
  return <Icon name="pause" {...p} />;
}
export function ChatBubbleIcon(p: ConvenienceProps) {
  return <Icon name="chatBubble" {...p} />;
}
export function ClockIcon(p: ConvenienceProps) {
  return <Icon name="clock" {...p} />;
}
export function ArrowDownIcon(p: ConvenienceProps) {
  return <Icon name="arrowDown" {...p} />;
}
export function ArrowLeftIcon(p: ConvenienceProps) {
  return <Icon name="arrowLeft" {...p} />;
}
export function ArrowRightIcon(p: ConvenienceProps) {
  return <Icon name="arrowRight" {...p} />;
}
export function ChevronRightIcon(p: ConvenienceProps) {
  return <Icon name="chevronRight" {...p} />;
}
export function CancelIcon(p: ConvenienceProps) {
  return <Icon name="x" {...p} />;
}
export function TickIcon(p: ConvenienceProps) {
  return <Icon name="check" {...p} />;
}
export function FileTextIcon(p: ConvenienceProps) {
  return <Icon name="fileText" {...p} />;
}
export function BrainIcon(p: ConvenienceProps) {
  return <Icon name="brain" {...p} />;
}
export function BookIcon(p: ConvenienceProps) {
  return <Icon name="book" {...p} />;
}
export function TagIcon(p: ConvenienceProps) {
  return <Icon name="tag" {...p} />;
}
export function SpeedIcon(p: ConvenienceProps) {
  return <Icon name="bolt" {...p} />;
}
export function HomeIcon(p: ConvenienceProps) {
  return <Icon name="home" {...p} />;
}
export function LightbulbIcon(p: ConvenienceProps) {
  return <Icon name="lightbulb" {...p} />;
}
export function AlertCircleIcon(p: ConvenienceProps) {
  return <Icon name="alertCircle" {...p} />;
}
export function BarChartIcon(p: ConvenienceProps) {
  return <Icon name="barChart" {...p} />;
}
export function NewspaperIcon(p: ConvenienceProps) {
  return <Icon name="newspaper" {...p} />;
}
export function RssIcon(p: ConvenienceProps) {
  return <Icon name="rss" {...p} />;
}
export function CircleDollarIcon(p: ConvenienceProps) {
  return <Icon name="circleDollar" {...p} />;
}
export function UndoIcon(p: ConvenienceProps) {
  return <Icon name="undo" {...p} />;
}
export function ShieldIcon(p: ConvenienceProps) {
  return <Icon name="shield" {...p} />;
}
export function ShieldCheckIcon(p: ConvenienceProps) {
  return <Icon name="shieldCheck" {...p} />;
}
export function CheckCircleIcon(p: ConvenienceProps) {
  return <Icon name="checkCircle" {...p} />;
}
export function ImportIcon(p: ConvenienceProps) {
  return <Icon name="import" {...p} />;
}
export function FileDownIcon(p: ConvenienceProps) {
  return <Icon name="fileDown" {...p} />;
}
export function FlaskIcon(p: ConvenienceProps) {
  return <Icon name="flask" {...p} />;
}
export function MicroscopeIcon(p: ConvenienceProps) {
  return <Icon name="microscope" {...p} />;
}
export function GlobeIcon(p: ConvenienceProps) {
  return <Icon name="globe" {...p} />;
}
export function SparklesIcon(p: ConvenienceProps) {
  return <Icon name="sparkles" {...p} />;
}
export function ImageIcon(p: ConvenienceProps) {
  return <Icon name="image" {...p} />;
}
export function FileUpIcon(p: ConvenienceProps) {
  return <Icon name="fileUp" {...p} />;
}
export function BroomIcon(p: ConvenienceProps) {
  return <Icon name="broom" {...p} />;
}
export function PlayCircleIcon(p: ConvenienceProps) {
  return <Icon name="playCircle" {...p} />;
}
export function TrashCanIcon(p: ConvenienceProps) {
  return <Icon name="trashCan" {...p} />;
}
export function FolderIcon(p: ConvenienceProps) {
  return <Icon name="folder" {...p} />;
}
export function ShareNetworkIcon(p: ConvenienceProps) {
  return <Icon name="shareNetwork" {...p} />;
}
export function NetworkIcon(p: ConvenienceProps) {
  return <Icon name="network" {...p} />;
}
export function GridViewIcon(p: ConvenienceProps) {
  return <Icon name="gridView" {...p} />;
}
export function ListViewIcon(p: ConvenienceProps) {
  return <Icon name="listView" {...p} />;
}
export function PlayFillIcon(p: ConvenienceProps) {
  return <Icon name="playFill" {...p} />;
}
export function StopCircleIcon(p: ConvenienceProps) {
  return <Icon name="stopCircle" {...p} />;
}
export function FunnelIcon(p: ConvenienceProps) {
  return <Icon name="funnel" {...p} />;
}
export function CopyPlusIcon(p: ConvenienceProps) {
  return <Icon name="copyPlus" {...p} />;
}
export function BookOpenIcon(p: ConvenienceProps) {
  return <Icon name="bookOpen" {...p} />;
}
export function LayersIcon(p: ConvenienceProps) {
  return <Icon name="layers" {...p} />;
}
export function InfoIcon(p: ConvenienceProps) {
  return <Icon name="info" {...p} />;
}
export function AlertTriangleIcon(p: ConvenienceProps) {
  return <Icon name="alertTriangle" {...p} />;
}
export function ExternalLinkIcon(p: ConvenienceProps) {
  return <Icon name="externalLink" {...p} />;
}
export function LinkIcon(p: ConvenienceProps) {
  return <Icon name="link" {...p} />;
}
export function CalendarIcon(p: ConvenienceProps) {
  return <Icon name="calendar" {...p} />;
}
export function TrendingUpIcon(p: ConvenienceProps) {
  return <Icon name="trendingUp" {...p} />;
}
export function TrendingDownIcon(p: ConvenienceProps) {
  return <Icon name="trendingDown" {...p} />;
}
export function DatabaseIcon(p: ConvenienceProps) {
  return <Icon name="database" {...p} />;
}
export function HistoryIcon(p: ConvenienceProps) {
  return <Icon name="history" {...p} />;
}
export function StarIcon(p: ConvenienceProps) {
  return <Icon name="star" {...p} />;
}
export function HeartIcon(p: ConvenienceProps) {
  return <Icon name="heart" {...p} />;
}
export function ThumbsUpIcon(p: ConvenienceProps) {
  return <Icon name="thumbsUp" {...p} />;
}
export function ThumbsDownIcon(p: ConvenienceProps) {
  return <Icon name="thumbsDown" {...p} />;
}
export function Share2Icon(p: ConvenienceProps) {
  return <Icon name="share2" {...p} />;
}
export function CopyCheckIcon(p: ConvenienceProps) {
  return <Icon name="copyCheck" {...p} />;
}
