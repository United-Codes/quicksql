create table "日本語" (
    id        number default on null to_number(sys_guid(), 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') 
              constraint "日本語_id_pk" primary key,
    status    integer constraint "日本語_status_ck"
              check (status in (1,2,3))
);
