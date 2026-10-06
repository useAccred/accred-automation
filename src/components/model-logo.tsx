import { Sparkles } from "lucide-react";
import Image from "next/image";
import { modelBrand } from "@/lib/model-brand";

/** The maker's logo for a model, on a light tile so dark marks stay visible. A model with no known maker gets a neutral mark. */
export function ModelLogo({ modelId, size = 20 }: { modelId: string; size?: number }) {
  const brand = modelBrand(modelId);
  const mark = Math.round(size * 0.68);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md ${brand ? "bg-white" : "border border-line text-muted"}`}
      style={{ width: size, height: size }}
      title={brand?.label}
    >
      {brand ? <Image src={`/brand/models/${brand.key}.svg`} alt="" width={mark} height={mark} unoptimized /> : <Sparkles size={mark} aria-hidden />}
    </span>
  );
}
