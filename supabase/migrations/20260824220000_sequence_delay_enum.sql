-- Um delay puro não deve ser confundido com o indicador visual de digitação.
alter type public.sequence_step_kind add value if not exists 'delay';
