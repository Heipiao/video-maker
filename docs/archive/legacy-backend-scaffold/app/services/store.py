from app.models.project import ExportJob, WeddingProject


class InMemoryStore:
    def __init__(self) -> None:
        self.projects: dict[str, WeddingProject] = {}
        self.jobs: dict[str, ExportJob] = {}

    def add_project(self, project: WeddingProject) -> WeddingProject:
        self.projects[project.id] = project
        return project

    def get_project(self, project_id: str) -> WeddingProject | None:
        return self.projects.get(project_id)

    def list_projects(self) -> list[WeddingProject]:
        return sorted(self.projects.values(), key=lambda project: project.updated_at, reverse=True)

    def save_job(self, job: ExportJob) -> ExportJob:
        self.jobs[job.id] = job
        return job

    def get_job(self, job_id: str) -> ExportJob | None:
        return self.jobs.get(job_id)


store = InMemoryStore()
