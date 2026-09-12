update public.external_data_processors
set processor_key = 'github_pages',
    provider_name = 'GitHub Pages',
    service_scope = 'Hospedagem e entrega do frontend público',
    data_categories = array['dados técnicos de requisição','IP e logs de entrega quando gerados pela plataforma'],
    purpose = 'Hospedar e entregar o site teacherflavius.com.',
    provider_retention = 'Retenção de logs e dados de plataforma depende dos controles e políticas do GitHub.',
    internal_control = 'Frontend público é entregue por GitHub Pages; não publicar PII, segredos ou artefatos operacionais no conteúdo estático.',
    verification_status = 'pending',
    last_verified_at = null,
    next_review_at = date '2026-09-19',
    official_reference = 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
    notes = 'GitHub Pages hospeda o frontend público. O repositório GitHub permanece sujeito aos controles separados de código e histórico.',
    updated_at = now()
where processor_key = 'netlify';
