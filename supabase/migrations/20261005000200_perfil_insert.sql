-- O próprio usuário pode criar o seu perfil, se ainda não existir.
-- (Normalmente o trigger handle_new_user já cria; isto cobre contas antigas ou falhas no cadastro.)
drop policy if exists "perfil próprio: criar" on profiles;
create policy "perfil próprio: criar" on profiles for insert with check (id = auth.uid());
