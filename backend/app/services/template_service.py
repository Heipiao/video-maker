from app.models.catalog import TEMPLATES, Template
from app.models.spec import WeddingVideoSpec


class UnknownTemplateError(Exception):
    pass


class TemplateValidationError(Exception):
    pass


class TemplateService:
    def __init__(self) -> None:
        self.templates = {template.id: template for template in TEMPLATES}

    def get(self, template_id: str) -> Template:
        try:
            return self.templates[template_id]
        except KeyError as exc:
            raise UnknownTemplateError(template_id) from exc

    def validate_spec(self, spec: WeddingVideoSpec) -> None:
        template = self.get(spec.template_id)
        editable_style = template.editable_schema.get("style", {})
        if isinstance(editable_style.get("font"), list) and spec.style.font not in editable_style["font"]:
            raise TemplateValidationError(f"Font is not editable for template: {spec.style.font}")
        if (
            isinstance(editable_style.get("transition"), list)
            and spec.style.transition not in editable_style["transition"]
        ):
            raise TemplateValidationError(
                f"Transition is not editable for template: {spec.style.transition}"
            )
        if (
            isinstance(editable_style.get("photo_motion"), list)
            and spec.style.photo_motion not in editable_style["photo_motion"]
        ):
            raise TemplateValidationError(
                f"Photo motion is not editable for template: {spec.style.photo_motion}"
            )
        if (
            isinstance(editable_style.get("caption_position"), list)
            and spec.style.caption_position not in editable_style["caption_position"]
        ):
            raise TemplateValidationError(
                f"Caption position is not editable for template: {spec.style.caption_position}"
            )
