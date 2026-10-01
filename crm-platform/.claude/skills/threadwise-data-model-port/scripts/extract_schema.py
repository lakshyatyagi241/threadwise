"""Snapshot the Reference reference database's schema (information_schema only, no row data) into threadwise-schema.json.
Needs the reference DB from the threadwise-run-reference skill. env: THREADWISE_DB_USER/PASS/NAME. Output dir: $SCHEMA_SRC or docs/threadwise-port/schema/source."""
import subprocess, json, sys, os
U = os.environ.get("THREADWISE_DB_USER", "threadwise"); P = os.environ.get("THREADWISE_DB_PASS", "threadwise_local_pw"); DB = os.environ.get("THREADWISE_DB_NAME", "threadwise")
SRC = os.environ.get("SCHEMA_SRC") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "docs", "threadwise-port", "schema", "source")
def q(sql):
    r=subprocess.run(["mysql",f"-u{U}",f"-p{P}",DB,"-B","-N","--raw","-e",sql],capture_output=True,text=True)
    if r.returncode: sys.exit(r.stderr)
    return [l.split("\t") for l in r.stdout.split("\n") if l!=""]
tables={}
for n,eng,rows,cmt in q(f"select table_name,engine,table_rows,table_comment from information_schema.tables where table_schema='{DB}' and table_type='BASE TABLE' order by table_name"):
    tables[n]={"engine":eng,"rows_est":int(rows or 0),"comment":cmt,"columns":[],"indexes":{},"fks":[]}
for r in q(f"select table_name,column_name,column_type,data_type,is_nullable,column_default,extra,column_comment,character_maximum_length,numeric_precision,numeric_scale,ordinal_position from information_schema.columns where table_schema='{DB}' order by table_name,ordinal_position"):
    t=r[0]
    if t not in tables: continue
    tables[t]["columns"].append(dict(zip(["name","ctype","dtype","nullable","default","extra","comment","maxlen","prec","scale","pos"],r[1:])))
for r in q(f"select table_name,index_name,non_unique,seq_in_index,column_name,index_type from information_schema.statistics where table_schema='{DB}' order by table_name,index_name,seq_in_index"):
    t=r[0]
    if t not in tables: continue
    tables[t]["indexes"].setdefault(r[1],{"unique":r[2]=="0","type":r[5],"cols":[]})["cols"].append(r[4])
for r in q(f"select k.table_name,k.constraint_name,k.column_name,k.referenced_table_name,k.referenced_column_name,r.delete_rule,r.update_rule from information_schema.key_column_usage k join information_schema.referential_constraints r on r.constraint_name=k.constraint_name and r.constraint_schema=k.constraint_schema where k.table_schema='{DB}' and k.referenced_table_name is not null order by k.table_name,k.constraint_name,k.ordinal_position"):
    tables[r[0]]["fks"].append(dict(zip(["name","col","ref_table","ref_col","on_delete","on_update"],r[1:])))
os.makedirs(SRC, exist_ok=True)
json.dump(tables, open(os.path.join(SRC, "threadwise-schema.json"), "w"), separators=(",", ":"))
print(len(tables), sum(len(t["columns"]) for t in tables.values()))
