-- Lead Hunter — imagem com link na assinatura dos e-mails (incremental, só adiciona).
alter table profiles add column if not exists signature_image_url text;
alter table profiles add column if not exists signature_link_url text;
alter table profiles add column if not exists signature_image_width int;

-- Pasta pública para as imagens de assinatura (precisa ser pública para aparecer no e-mail do lead).
-- Cada usuário só envia, troca ou apaga arquivos na própria pasta (<id do usuário>/...). Até 1 MB, só imagens.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assinaturas', 'assinaturas', true, 1048576, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "assinaturas: enviar a própria" on storage.objects;
create policy "assinaturas: enviar a própria" on storage.objects for insert to authenticated
  with check (bucket_id = 'assinaturas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "assinaturas: trocar a própria" on storage.objects;
create policy "assinaturas: trocar a própria" on storage.objects for update to authenticated
  using (bucket_id = 'assinaturas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "assinaturas: apagar a própria" on storage.objects;
create policy "assinaturas: apagar a própria" on storage.objects for delete to authenticated
  using (bucket_id = 'assinaturas' and (storage.foldername(name))[1] = auth.uid()::text);
