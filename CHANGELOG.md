# Change Log

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [1.2.0] - 2023-11-8

[Compatible API amendments](https://github.com/oracle/quicksql/issues/23)

The former calls `toDDL` and `toERD`

```
   let output = toDDL(input,opt);
```

are encouraged to be replaced with

```
   let qsql = new quicksql(input,opt); // parse once only
   let output = qsql.getDDL();
   let errors = qsql.getErrors();
```

## [1.2.1] - 2024-2-8

Issues up to #51

Further Json to QSQL parsing progress

Performance optimization: from 12 sec down to 4.5 sec for 1000 line QSQL schema definition
in test/profile.js (test for pk-fk chain of 333 tables, 3 column each; 268 ms for chain of
50 tables, 20 columns each).

## [1.2.2] - 2024-2-15

Issue #52

Fixed invalid 'Misaligned Table ...' error, exhibited in vscode QSQL extension (yet to be published).

## [1.2.4] - 2024-2-22

NPX command

Error diagnostic fixes

## [1.2.10] - 2024-3-22

#41

## [1.2.11] - 2024-3-22

#57
#62
#63

## [1.2.12] - 2024-4-2

Misindented error diagnostics, one more time
Table and column directive syntax check

## [1.2.14] - 2024-9-22

#65
#67
#84

## [1.2.15] - 2024-9-24

#71
#78

## United-Codes Fork

### 1.3.0 - 2026-02-06

#### Added

- **26ai database version**: Added `26ai` as a supported value for the `db` setting.

#### Fixed

- **Reserved word prefix with user prefix**: Skip reserved word prefix when a user-defined prefix is already set.

### 1.3.1 - 2026-02-06

#### Added

- **Flashback Data Archive directives**: New `/flashback` and `/fda` table directives to enable Flashback Data Archive on tables. Optionally specify an archive name, e.g. `/flashback myarchive`.

### 1.3.2 - 2026-02-06

#### Added

- **Oracle 23ai annotations**: New `{key 'value'}` syntax for adding Oracle SQL annotations to tables, columns, and views. Supports key-value pairs, flag annotations, and multiple annotations per element.

### 1.3.3 - 2026-02-06

#### Added

- **Translation directive** (`/trans`, `/translation`, `/translations`): New column directive for multi-lingual translation support. Automatically generates a shared `language` table, a `<table>_trans` table with translated column variants, and a `<table>_resolved` view that joins them using `sys_context` for the current language. Configurable via the `transcontext` setting.

### 1.3.4 - 2026-02-06

#### Added

- **DESCRIPTION annotation comment generation**: When a table or column annotation includes a `DESCRIPTION` key (e.g., `{DESCRIPTION 'Main HR table'}`), a `COMMENT ON TABLE` or `COMMENT ON COLUMN` statement is automatically generated. The `DESCRIPTION` annotation takes precedence over explicit comments.
- **Double-quoted annotation values**: Annotation values now support both single quotes (`'value'`) and double quotes (`"value"`).

### 1.3.5 - 2026-02-09

#### Added

- **Immutable tables** (`/immutable`): New table directive that generates a `BEFORE UPDATE OR DELETE` trigger preventing any modifications after insert. Use for audit logs, inspection records, and other append-only tables.
- **SODA collections** (`/soda`): New table directive that generates a fixed-schema SODA-compatible collection table with `id`, `created_on`, `last_modified`, `version`, and `json_document` columns. Child columns are ignored.
- **Table groups** (`{GROUP 'name'}`): New `GROUP` annotation on tables that generates `INSERT` statements into `USER_ANNOTATIONS_GROUPS$` and `USER_ANNOTATIONS_GROUP_MEMBERS$` for logical table grouping.
- **Translation-aware views**: Views over tables with `/trans` columns now automatically use `coalesce(t.trans_col, tbl.col)` expressions and `LEFT JOIN` to the `_trans` table with the configured `transcontext` language filter.

#### Fixed

- **Default date expressions**: SQL date expressions (`sysdate`, `current_date`, `current_timestamp`, `systimestamp`, `localtimestamp`) used with `/default` are no longer incorrectly quoted on timestamp and varchar columns.
