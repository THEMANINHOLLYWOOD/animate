import Editor from "@/editor/ui/Editor";

export default async function EditorPage({ params }: PageProps<"/editor/[id]">) {
  const { id } = await params;
  // Keyed by film: moving to another film's editor opens it afresh.
  return <Editor key={id} id={id} />;
}
