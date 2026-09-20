from backend.core.knowledge_publisher import KnowledgePublisher
from backend.core.runtime import Runtime


class PrivateKnowledgePublisher(KnowledgePublisher):
    """Reuse core reporting while serving artifacts through authenticated previews."""

    def publish_to_drive_or_local(
        self, title: str, markdown_content: str, filename_prefix: str
    ) -> tuple[str, str, str]:
        uri = self.blobs.upload(
            f"knowledge/{filename_prefix}.md",
            markdown_content.encode("utf-8"),
            "text/markdown; charset=utf-8",
        )
        return (
            f"private-{filename_prefix}",
            f"/api/knowledge-base/preview/{filename_prefix}",
            uri,
        )


def secure_knowledge_publisher(runtime: Runtime) -> None:
    publisher = runtime.knowledge_publisher
    # Keep explicitly injected test or deployment implementations intact.
    if type(publisher) is KnowledgePublisher:
        runtime.knowledge_publisher = PrivateKnowledgePublisher(
            repository=publisher.repository,
            explainer=publisher.explainer,
            settings=publisher.settings,
            local_dir=publisher.local_dir,
            blobs=publisher.blobs,
        )
