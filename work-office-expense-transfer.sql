begin;

alter table public.work_finance_transactions
  add column transfer_recipient text,
  add column transfer_account_number text,
  add constraint work_finance_transfer_details_expense_only check (
    flow_type = '지출' or (transfer_recipient is null and transfer_account_number is null)
  ),
  add constraint work_finance_transfer_recipient_format check (
    transfer_recipient is null or char_length(btrim(transfer_recipient)) between 1 and 100
  ),
  add constraint work_finance_transfer_account_format check (
    transfer_account_number is null or (
      transfer_account_number ~ '^[0-9]+(-[0-9]+)*$'
      and char_length(replace(transfer_account_number, '-', '')) between 4 and 24
    )
  );

commit;
