/**
 * Settings 子组件共享的图标 re-export。
 *
 * 单独建一个文件，原因：
 *  1. 让子组件相对路径短（'./icons' 而非 '../../../utils/icons'）
 *  2. 提供 Star 图标（now backed by lucide-react）
 */
import { Star, LogIn, LogOut } from "lucide-react";

export {
  CopyIconSvg,
  CheckIconSvg,
  EyeIconSvg,
  EyeOffIconSvg,
  ChevronDownIconSvg,
  ChevronUpIconSvg,
  ChevronRightIconSvg,
  TrashIconSvg,
  ArrowLeftIconSvg,
  ShieldIconSvg,
  BotIconSvg,
  PencilIconSvg,
  PlusIconSvg,
} from "../../../../utils/icons";

// Aliases（保持 ApiKeyInput.tsx 里现有的命名）
export {
  EyeIconSvg as EyeIconSvgIfPresent,
  EyeOffIconSvg as EyeOffIconSvgIfPresent,
} from "../../../../utils/icons";

/** Star 图标（lucide-react）。用于标记"默认模型"。 */
export const StarIconSvgIfPresent = Star;
export const LogInIconSvg = LogIn;
export const LogOutIconSvg = LogOut;
