/* globals __PACKAGE_VERSION__ */

import tree from './tree.js';
import lexer from './lexer.js';
import json2qsql from './json2qsql.js'
import errorMsgs from './errorMsgs.js'
import {canonicalObjectName, getMajorVersion} from './naming.js'

const identityDataType = 'identityDataType';
const guid = 'guid';
const tswtz = 'Timestamp with time zone';
const tswltz = 'Timestamp with local time zone';

// Pre-computed lowercase versions for normalize()
const identityDataType_lower = identityDataType.toLowerCase();
const guid_lower = guid.toLowerCase();
const tswtz_lower = tswtz.toLowerCase();
const tswltz_lower = tswltz.toLowerCase();

export const quicksql = (function () {

    const defaultOptions = { 
        apex: {label: 'APEX', value:'no',check:['yes','no']},
        auditcols: {label: 'Audit Columns', value:'no',check:['yes','no']},
            createdcol: {label: 'Created Column Name', value: 'created'},
            createdbycol: {label: 'Created By Column Name', value: 'created_by'},
            updatedcol: {label: 'Updated Column Name', value: 'updated'},
            updatedbycol: {label: 'Updated By Column Name', value: 'updated_by'},
            auditdate: {label: 'Audit Column Date Type', value:''},
        aienrichment: {label: 'AI Enrichment', value:'no',check:['yes','no']},
        boolean: {label: 'Boolean Datatype', value:'not set',check:['yn','native']},
        genpk: {label:'Auto Primary Key', value:'yes',check:['yes','no']},
        semantics: {label: 'Character Strings',value:'CHAR',check:['BYTE','CHAR','Default']},
        language: {label: 'Data Language', value:'EN',check:['EN','JP','KO']},
        datalimit: {label: 'Data Limit Rows', value: 10000},
        date: {label: 'Date Data Type', value:'DATE',check:['DATE','TIMESTAMP',tswtz,tswltz]},
        db: {label: 'Database Version', value:'not set'},  
        dv: {label: 'Duality View', value:'no',check:['yes','no']},  // switched default to 'no' until thorough development&testig
        drop: {label: 'Include Drops', value:'no',check:['yes','no']},
        editionable: {label: 'Editinable', value:'no',check:['yes','no']},
        inserts: {label: 'Generate Inserts', value:true, check:['yes','no']},
        //longvc: {label: 'Longer Varchars', value:'yes',check:['yes','no']},    // not used, if a user specified the length, presumably he knows what he is doing
        //columnNamePrefix: "?",
        namelen: {label: 'Name Character Length', value: 255},
        overridesettings: {label: 'Ignore toDDL() second parameter', value:'no',check:['yes','no']},    
        prefix: {label: 'Object Prefix', value:'' },
        //ondelete: {label: 'On Delete', value:'Cascade',check:['restrict','cascade','set null']},
        pk: { label: 'Primary Key Maintenance', value: guid, check: [identityDataType, guid,'SEQ', 'NONE']},
        prefixpkwithtname: {label:'Prefix primary keys with table name', value:'no',check:['yes','no']}, 
        rowkey: {label: 'Alphanumeric Row Identifier', value:'no',check:['yes','no']},
        rowversion: {label: 'Row Version Number', value:'no',check:['yes','no']},
        schema: {label: 'Schema', value:'', },
        api: {label: 'Table API', value:'no',check:['yes','no']},
        compress: {label: 'Table Compression', value:'no',check:['yes','no']},
        transcontext: {label: 'Translation Context', value: "sys_context('APP_CTX','LANG')"},
        //"Auxiliary Columns": {label: "Auxiliary Columns", value:''}, // e.g. security_group_id integer

        //namecase: {label: 'Object and Field name convention', value:'canonic',check:['canonic','json']},
    };

    function normalize( iNput ) {
        if( iNput == null )
            return null;
        let input = iNput;
        if( typeof input === 'string' ) 
            input = input.toLowerCase();
        if( input == 'yes') return true;
        if( input == 'no') return false;
        if( input == 'y') return true;
        if( input == 'n') return false;
        if( input == 'true') return true;
        if( input == 'false') return false;
        if( input == identityDataType_lower ) return 'identity';
        if( input == guid_lower ) return 'guid';
        if( input == tswtz_lower ) return 'tswtz';
        if( input == tswltz_lower ) return 'tswltz';
        return input;
    };


    function Parsed( fullInput, options ) {
        this.ddl = null;
        this.erd = null;
        this.errors = null;
        this.options = JSON.parse(JSON.stringify(defaultOptions));
        this.input = fullInput;
        this.postponedAlters = [];
        this.postponedAltersSet = new Set();

        // Pre-compute label-to-key lookup map for getOptionValue
        this._labelToKey = {};
        for( let x in this.options ) {
            const lbl = this.options[x].label;
            if( lbl != null )
                this._labelToKey[lbl.toLowerCase()] = x;
        }

        this.getOptionValue = function( kEy ) {
            const key = kEy.toLowerCase();
            let option = this.options[key];
            if( !(key in this.options) ) {
                const mapped = this._labelToKey[key];
                if( mapped != null )
                    option = this.options[mapped];
            }
            if( option == null )
                return null;
            return option.value;
        };
        this.optionEQvalue = function( key, value ) {
            var v = this.getOptionValue(key);

            let ret = normalize(v) == normalize(value);
            return ret;
        };
        this.nonDefaultOptions = function() {
            let ret = {};
            for( let x in this.options ) {
                if( defaultOptions[x] && !this.optionEQvalue(x,defaultOptions[x].value) )
                    ret[x] = this.options[x].value;
            }
            return ret;
        };
        this.unknownOptions = function() {
            let ret = [];
            for( let x in this.options ) {
                if( defaultOptions[x] == null )
                    ret.push(x); 
            }
            return ret;
        };
        this.setOptionValue = function( kEy, value ) {
            let key = kEy.toLowerCase(); 
            // var option = this.options[key];
            if( !(key in this.options) ) {
                for( let x in this.options ) {
                    const label = this.options[x].label;
                    if( label == kEy ) {
                        this.options[x].value = value;
                        return;
                    }
                }
            }
            if( value == null )
                value = '';
            let option = this.options[key];
            if( option == null ) {
                option = {};
                this.options[key] = option;
            }
            option.value = value;
        };
        this.semantics = function() {
            var char = '';
            if( this.optionEQvalue('semantics','CHAR') )
                char = ' char';
            else if( this.optionEQvalue('semantics','BYTE') )
                char = ' byte';
            return char;	
        };
        this.name2node = null;
        this.find = function( name ) {
            if( this.name2node != null ) 
                return this.name2node[canonicalObjectName(name)];

            this.name2node = {};    
            for( var i = 0; i < this.forest.length; i++ ) {
                var descendants = this.forest[i].descendants();
                for( var j = 0; j < descendants.length; j++ ) {
                    var node = descendants[j];
                    this.name2node[node.parseName()] = node;
                }
            }
            return this.name2node[canonicalObjectName(name)];
        };

        this.setOptions = function( line ) {
            line = line.trim();
            if( line.startsWith('#') )
                line = line.substring(1).trim();
            const eqPos = line.indexOf('=');
            let tmp = line.substring(eqPos + 1).trim();
            if( tmp.indexOf('{') < 0 ) {
                tmp = '{' + line + '}';
            }
            let json = '';
            let src= lexer( tmp, true, true, '' );
            for( let i in src ) {
                let t = src[i];
                if( t.type == 'identifier' 
                   && t.value != 'true'
                   && t.value != 'false'
                   && t.value != 'null'
                )
                    json += '"'+t.value+'"';
                else
                    json += t.value;	
            }
            let settings = JSON.parse(json);
            for( let x in settings ) 
                this.setOptionValue(x.toLowerCase(),settings[x]);
            
        }
    
        this.descendants = function () {
            var ret = [];
            for( var i = 0; i < this.forest.length; i++ ) {
                ret.push(...this.forest[i].descendants());
            }
            return ret;
        };
        
        this.additionalColumns = function() {
            var ret = []; 
            var input = this.getOptionValue('Auxiliary Columns');
            if( input == null )
                return ret;
            var tmps = input.split(',');
            for( var i = 0; i < tmps.length; i++ ) {
                var attr = tmps[i].trim();
                var type = 'VARCHAR2(4000)';
                var pos = attr.indexOf(' ');
                if( 0 < pos ) {
                    type = attr.substring(pos+1).toUpperCase();
                    attr = attr.substring(0,pos);
                }
                ret[attr] = type;
            }
            return ret;
        };

        this.objPrefix = function ( withoutSchema ) {
            var ret = this.getOptionValue('schema');
            if( ret == null )
                ret = '';
            if( '' != ret && withoutSchema == null )
                ret = ret + '.';
            else 
                ret = '';
            var value = '';
            if( this.getOptionValue('prefix') != null )
                value = this.getOptionValue('prefix');
            ret = ret + value;
            if( value != '' && !value.endsWith('_') )
                ret = ret + '_';
            return ret.toLowerCase();
        };

        let settings = '';
        if( 0 < fullInput.toLowerCase().indexOf('overridesettings') )
            tree(this);  // little excessive to read just one option
        if( options != undefined && this.optionEQvalue('overrideSettings',false) ) {
            settings = '# settings = '+options+'\n\n';
        } 
        this.input = settings + fullInput;   
        this.forest = tree(this);
 

        /**
         * @returns JSON object for tables and fk relationships
         */
        this.getERD = function () {
            if( this.erd != null )
                return this.erd;

            let descendants = this.descendants();
 
            let output = {items:[]};

            for( let i = 0; i < descendants.length; i++ ) {
                if( descendants[i].parseType() != 'table' ) 
                    continue;

                let item = {name: this.objPrefix('no schema')  +descendants[i].parseName('')};
                let schema = this.getOptionValue('schema');
                if( '' == schema )
                    schema = null;
                //if( schema != null )
                    //schema = '"'+schema+'"';
                item.schema = schema;
                item.columns = []
                
                output.items.push(item);

                let idColName = descendants[i].getGenIdColName();
                if( idColName != null && !descendants[i].isOption('pk') ) {
                    item.columns.push({name: idColName, datatype: "number"});
                } else {
                    let pkName = descendants[i].getExplicitPkName();
                    if( pkName != null && pkName.indexOf(',') < 0 ) {
                        let type = 'number';
                        const child = descendants[i].findChild(pkName);
                        if( child != null )
                            type = child.parseType(true);
                        item.columns.push({name: pkName, datatype: type});
                    }
                }
     
                descendants[i].lateInitFks();
                for( let fk in descendants[i].fks ) {
                    let parent = descendants[i].fks[fk];
                    if( 0 < fk.indexOf(',') ) {
                        let refNode = this.find(parent);
                        var chunks = split_str(fk,', ');
                        for( var ii = 0; ii < chunks.length; ii++ ) {
                            var col = chunks[ii];
                            if( col == ',' )
                                continue;
                            const pChild = refNode.findChild(col);
                            item.columns.push({name: col, datatype: pChild.parseType(true)});
                        }
                        continue;
                    }
                    let type = 'number';
                    const attr = descendants[i].findChild(fk);
                    if( attr != null )
                        type = attr.parseType('fk');		
                    let refNode = this.find(parent);
                    let _id = ''; 
                    if( refNode != null ) {
                        const rname = refNode.getExplicitPkName();  
                        if( rname != null && rname.indexOf(',') < 0 )
                            type = refNode.getPkType();  
                    } else {
                        refNode = this.find(fk);
                        if( refNode.isMany2One() & !fk.endsWith('_id') ) {
                            parent = fk;
                            fk = singular(fk);
                            _id = '_id';  
                        }
                    }
                    item.columns.push({name: fk, datatype: type});                    
                }
    
                let explicitPk = descendants[i].getExplicitPkName();
                for( let j = 0; j < descendants[i].children.length; j++ ) {
                    let child = descendants[i].children[j];
                    if( child.parseType() == 'table' )
                        continue;
                    if( child.refId() != null )
                        continue;
                    if( child.parseName() == explicitPk )
                        continue;
                    item.columns.push({name: child.parseName(''), datatype: child.parseType(true)});
                    if( 0 < child.indexOf('file') ) {
                        const col = child.parseName();
                        item.columns.push({name: col+'_filename', datatype: 'varchar2(255'+this.semantics()+ ')'});
                        item.columns.push({name: col+'_mimetype', datatype: 'varchar2(255'+this.semantics()+ ')'});
                        item.columns.push({name: col+'_charset',  datatype: 'varchar2(255'+this.semantics()+ ')'});
                        item.columns.push({name: col+'_lastupd', datatype:  'date'});
                    }
                }

                const nodeContent = descendants[i].trimmedContent().toUpperCase();
                if( this.optionEQvalue('rowkey',true) || 0 < nodeContent.indexOf('/ROWKEY') ) {
                    item.columns.push({name: 'row_key', datatype: 'varchar2(30'+this.semantics()+ ')'});
                }            	
                if( this.optionEQvalue('rowVersion','yes') || 0 < nodeContent.indexOf('/ROWVERSION') ) {
                    item.columns.push({name: 'row_version', datatype: 'integer'});
                }            	
                if( this.optionEQvalue('Audit Columns','yes') || 0 < nodeContent.indexOf('/AUDITCOLS') ) {
                    let auditDateType = this.getOptionValue('auditdate');
                    if( auditDateType == null || auditDateType == '' )
                        auditDateType = this.getOptionValue('Date Data Type');
                    auditDateType = auditDateType.toLowerCase();
                    let created = this.getOptionValue('createdcol');
                    item.columns.push({name: created, datatype: auditDateType});
                    let createdby = this.getOptionValue('createdbycol');
                    item.columns.push({name: createdby, datatype: 'varchar2(255'+this.semantics()+')'});
                    let updated = this.getOptionValue('updatedcol');
                    item.columns.push({name: updated, datatype: auditDateType});
                    let updatedby = this.getOptionValue('updatedbycol');
                    item.columns.push({name: updatedby, datatype: 'varchar2(255'+this.semantics()+')'});
                }            	
                var cols = this.additionalColumns();
                for( let col in cols ) {
                    var type = cols[col];
                    pad = tab+' '.repeat(this.maxChildNameLen() - col.length);
                    ret += tab +  col.toUpperCase() + pad + type + ' not null,\n';  
                }
        
            }

            output.links = [];

            for( let i = 0; i < descendants.length; i++ ) {
                if( descendants[i].parseType() != 'table' ) 
                    continue;

                descendants[i].toDDL();    // to setup fks

                for( let fk in descendants[i].fks ) {	
                    let parent = descendants[i].fks[fk];
                    let pkNode = this.find(parent);
                    if( pkNode == null )
                        continue;
                    let pk = 'id';
                    if( pkNode.getExplicitPkName() != null )
                        pk = pkNode.getExplicitPkName();				
 
                    output.links.push({source: this.objPrefix() +parent, source_id: pk,
                                       target: this.objPrefix() + descendants[i].parseName(''), target_id: fk
                    });
                }
            }

            output.groups = {};
            for( let i = 0; i < descendants.length; i++ ) {
                if( descendants[i].parseType() != 'table' ) continue;
                let groupName = descendants[i].getAnnotationValue('GROUP');
                if( groupName != null ) {
                    if( !output.groups[groupName] ) output.groups[groupName] = [];
                    output.groups[groupName].push(
                        this.objPrefix('no schema') + descendants[i].parseName('')
                    );
                }
            }

            this.erd = output;
            return output;
        };

        this.getDDL = function () {
            if( this.ddl != null )
                return this.ddl;

            var output = '';

            var descendants = this.descendants();

            if( this.optionEQvalue('Include Drops','yes') )
                for( let i = 0; i < descendants.length; i++ ) {
                    let drop = descendants[i].generateDrop();
                    if( drop != '' )
                        output += drop;
                }

            if( this.optionEQvalue('rowkey',true) ) {
                output += 'create sequence  row_key_seq;\n\n';                
            } else for( let i = 0; i < this.forest.length; i++ ) {
                const nodeContent = this.forest[i].trimmedContent().toUpperCase();
                if( 0 < nodeContent.indexOf('/ROWKEY') ) {
                    output += 'create sequence  row_key_seq;\n\n'; 
                    break;
                }
            }
            
            output += '-- create tables\n\n';

            for( let i = 0; i < this.forest.length; i++ ) {
                output += this.forest[i].toDDL()+'\n';
            }

            for ( let i = 0; i < this.postponedAlters.length; i++ ) {
                output += this.postponedAlters[i]+'\n';
            }

            // translation tables
            let hasTransCols = false;
            for( let i = 0; i < descendants.length; i++ ) {
                if( descendants[i].getTransColumns && descendants[i].getTransColumns().length > 0 ) {
                    hasTransCols = true;
                    break;
                }
            }
            if( hasTransCols ) {
                let char = this.semantics();
                output += '-- translation support\n\n';
                output += 'create table ' + this.objPrefix() + 'language (\n';
                output += '    code           varchar2(5' + char + ') not null\n';
                output += '                   constraint ' + this.objPrefix() + 'language_code_pk primary key,\n';
                output += '    locale         varchar2(28' + char + ') not null\n';
                output += '                   constraint ' + this.objPrefix() + 'language_locale_unq unique,\n';
                output += '    name           varchar2(1024' + char + '),\n';
                output += '    native_name    varchar2(1024' + char + ')\n';
                output += ');\n\n';
                output += 'create index ' + this.objPrefix() + 'language_i1 on ' + this.objPrefix() + 'language (locale);\n\n';

                for( let i = 0; i < descendants.length; i++ ) {
                    let transTable = descendants[i].generateTransTable();
                    if( transTable != '' )
                        output += transTable;
                }
            }

            let j = 0;
            for( let i = 0; i < descendants.length; i++ ) {
                let trigger = descendants[i].generateTrigger();
                if( trigger != '' ) {
                    if( j++ == 0 )
                        output += '-- triggers\n';
                    output += trigger +'\n';
                }
            }
            for( let i = 0; i < descendants.length; i++ ) {
                let trigger = descendants[i].generateImmutableTrigger();
                if( trigger != '' ) {
                    if( j++ == 0 )
                        output += '-- immutable triggers\n';
                    output += trigger;
                }
            }
            j = 0;

            for( let i = 0; i < descendants.length; i++ ) {
                let ords = descendants[i].restEnable();
                if( ords != '' )
                    output += ords +'\n';
            }

            
            j = 0;
            for( let i = 0; i < descendants.length; i++ ) {
                if( this.optionEQvalue('api',false) 
                 && descendants[i].trimmedContent().toLowerCase().indexOf('/api') < 0 )
                    continue;
                let tapi = descendants[i].generateTAPI();
                if( tapi != '' ) {
                    if( j++ == 0)
                        output += '-- APIs\n';
                    output += tapi +'\n';
                }
            }

            j = 0;
            for( let i = 0; i < this.forest.length; i++ ) {
                let view = this.forest[i].generateView();
                if( view != '' ) {
                    if( j++ == 0)
                        output += '-- create views\n';
                    output += view +'\n';
                }
            }

            for( let i = 0; i < descendants.length; i++ ) {
                let resolvedView = descendants[i].generateResolvedView();
                if( resolvedView != '' ) {
                    if( j++ == 0)
                        output += '-- create views\n';
                    output += resolvedView;
                }
            }

            // table groups from GROUP annotations
            let groups = {};
            for( let i = 0; i < descendants.length; i++ ) {
                if( descendants[i].parseType() != 'table' ) continue;
                let groupName = descendants[i].getAnnotationValue('GROUP');
                if( groupName != null ) {
                    if( !groups[groupName] ) groups[groupName] = [];
                    groups[groupName].push(this.objPrefix() + descendants[i].parseName());
                }
            }
            let groupNames = Object.keys(groups);
            if( groupNames.length > 0 ) {
                output += '-- table groups\n';
                for( let g = 0; g < groupNames.length; g++ ) {
                    let gn = groupNames[g];
                    output += "insert into user_annotations_groups$ (group_name) values ('" + gn + "');\n";
                    let members = groups[gn];
                    for( let m = 0; m < members.length; m++ ) {
                        output += "insert into user_annotations_group_members$ (group_name, object_name) values ('" + gn + "', '" + members[m].toUpperCase() + "');\n";
                    }
                }
                output += '\n';
            }

            // AI enrichment calls (aienrichment setting + db >= 26)
            const enrichDbVer = this.getOptionValue('db');
            if( this.optionEQvalue('aienrichment',true) && enrichDbVer != null && enrichDbVer.length >= 2 && 26 <= getMajorVersion(enrichDbVer) ) {
                let enrichCalls = [];
                let enrichGroups = {};
                let prefix = this.objPrefix();

                for( let i = 0; i < this.forest.length; i++ ) {
                    let node = this.forest[i];
                    let type = node.parseType();
                    let pairs = node.getAnnotationPairs();
                    let objName = (prefix + node.parseName()).toUpperCase();

                    if( type == 'table' ) {
                        for( let p = 0; p < pairs.length; p++ ) {
                            if( pairs[p].label.toUpperCase() === 'GROUP' ) {
                                if( pairs[p].value != null ) {
                                    if( !enrichGroups[pairs[p].value] ) enrichGroups[pairs[p].value] = [];
                                    enrichGroups[pairs[p].value].push(objName);
                                }
                                continue;
                            }
                            if( pairs[p].value == null ) continue;
                            enrichCalls.push("    metadata_annotations.set('" + pairs[p].label + "', '" + pairs[p].value + "', '" + objName + "');");
                        }
                        for( let c = 0; c < node.children.length; c++ ) {
                            let col = node.children[c];
                            if( col.children.length > 0 ) continue;
                            let colPairs = col.getAnnotationPairs();
                            let colName = objName + '.' + col.parseName().toUpperCase();
                            for( let p = 0; p < colPairs.length; p++ ) {
                                if( colPairs[p].value == null ) continue;
                                enrichCalls.push("    metadata_annotations.set('" + colPairs[p].label + "', '" + colPairs[p].value + "', '" + colName + "', 'TABLE COLUMN');");
                            }
                        }
                    } else if( type == 'view' ) {
                        for( let p = 0; p < pairs.length; p++ ) {
                            if( pairs[p].value == null ) continue;
                            enrichCalls.push("    metadata_annotations.set('" + pairs[p].label + "', '" + pairs[p].value + "', '" + objName + "', 'VIEW');");
                        }
                    }
                }

                let enrichGroupNames = Object.keys(enrichGroups);
                for( let g = 0; g < enrichGroupNames.length; g++ ) {
                    let gn = enrichGroupNames[g];
                    enrichCalls.push("    metadata_annotations.create_group('" + gn + "');");
                    let members = enrichGroups[gn];
                    for( let m = 0; m < members.length; m++ ) {
                        enrichCalls.push("    metadata_annotations.add_to_group('" + gn + "', '" + members[m] + "', 'TABLE');");
                    }
                }

                if( enrichCalls.length > 0 ) {
                    output += '-- AI enrichment\nbegin\n';
                    output += enrichCalls.join('\n') + '\n';
                    output += 'end;\n/\n\n';
                }
            }

            j = 0;
            for( let i = 0; i < this.forest.length; i++ ) {
                let data = this.forest[i].generateData(this.data);
                if( data != '' ) {
                    if( j++ == 0)
                        output += '-- load data\n\n';
                    output += data+'\n';
                }
            }
            j = 0;

            output += '-- Generated by Quick SQL ' + `${this.version() } ` + new Date().toLocaleString() +'\n\n';

            output += '/*\n';
            //input = input.replace(/# ?settings ?= ?{.+}/gm,'');
            let inputWithoutComments = fullInput;
            inputWithoutComments = inputWithoutComments.replace(/#.+/g,'\n');
            inputWithoutComments = inputWithoutComments.replace(/\/\*/g,'--<--');
            inputWithoutComments = inputWithoutComments.replace(/\*\//g,'-->--');
            inputWithoutComments = inputWithoutComments.replace(/\/* Non-default options:/g,"");
            output += inputWithoutComments;
            output += '\n';
            for( let i = 0; i < this.unknownOptions().length; i++ ) {
                output += '*** Unknown setting: '+this.unknownOptions()[i]+'\n';
            }
            

            output += '\n Non-default options:\n# settings = '+JSON.stringify(this.nonDefaultOptions())+'\n';

            output += '\n*/';

            this.ddl = output;
            return output;
        }; 

        this.getErrors = function () {
            if( this.errors != null )
                return this.errors;

            this.errors = errorMsgs.findErrors(this, this.fullInput);

            return this.errors;
        }

        this.version = qsql_version;

    }
 
    return Parsed;
}());

/**
 * Translates JSON document into QSQL (experimental)
 * @param {*} input 
 * @param {*} name optional filename to have the named 
 * @returns 
 */
export function fromJSON( input, name ) {
    return json2qsql(input, name);
}

/**
 * @param {*} input schema in QSQL notation
 * @param {*} options 
 * @returns JSON object listing tables and links
 */
export function toERD( input, options ) {
    return new quicksql(input, options).getERD();
};

/**
 * @param {*} input schema in QSQL notation
 * @param {*} options 
 * @returns translated DDL 
 */
export function toDDL( input, options ) {
    return new quicksql(input, options).getDDL();
}; 
/**
 * @param {*} input schema in QSQL notation
 * @param {*} options 
 * @returns list of SyntaxError objects 
 */
export function toErrors( input, options ) {
    return new quicksql(input, options).getErrors();
}; 

export function qsql_version() {
    return typeof __PACKAGE_VERSION__ === 'undefined' ? 'development' : __PACKAGE_VERSION__
};

quicksql.version = qsql_version;
quicksql.toDDL = toDDL;  
quicksql.toERD = toERD;  
quicksql.toErrors = toErrors;  
quicksql.fromJSON = fromJSON; 
quicksql.lexer = lexer; 

export default quicksql;