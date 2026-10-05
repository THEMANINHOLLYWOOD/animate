import Editor from "@/editor/ui/Editor";

export default async function EditorPage({ params }: PageProps<"/editor/[id]">) {
  const { id } = await params;
  return <Editor id={id} />;
}
