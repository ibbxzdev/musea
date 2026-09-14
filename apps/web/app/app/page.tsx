import { redirect } from "next/navigation";

/**
 * `/app` is not a screen, it is the way in.
 *
 * Artifacts is the landing section because it is the one that always has something in it
 * once you have saved anything at all.
 */
export default function MuseaIndex() {
  redirect("/app/artifacts");
}
