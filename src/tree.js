import {singular,concatNames,canonicalObjectName, getMajorVersion} from './naming.js';
import translate from './translate.js';
import {generateSample, resetSeed} from './sample.js';
import lexer from './lexer.js';
import amend_reserved_word from './reserved_words.js';
import split_str from './split_str.js';

let tree = (function(){ 
    let ddl;
    let tab= '    ';
    const stringTypes = ['string', 'varchar2', 'varchar', 'vc' , 'char'];
    const boolTypes = ['yn', 'boolean', 'bool', ];
    const vectTypes = ['vect', 'vector', ];
    let datatypes = [
        'integer',
        'number', 'num',
        'int',
        'blob', 'clob',
        'json',
        'file',
        'date', 'd',
        'tstz',
        'tswtz',
        'tswltz',
        'ts',
    ];           
    datatypes = datatypes.concat(stringTypes);
    datatypes = datatypes.concat(boolTypes);
    datatypes = datatypes.concat(vectTypes);

    /**
     * Node in QSQL tree defining a Table, a Column, a View, or an Option
     * @param lineNo  -- line number
     * @param {*} inputLine -- QSQL line
     * @param {*} parent -- reference to parent node (if any)
     */
    function ddlnode( lineNo, inputLine, parent ) {
        this.line = lineNo;
        this.parent = parent;
        this.children = [];
        if( parent != null )
            parent.children.push(this);
        
        this.fks = null;

        this.findChild = function( name ) {
            for( var i = 0; i < this.children.length; i++ ) 
                if( this.children[i].parseName() == name )
                    return this.children[i];
            return null;
        };
                
        this.descendants = function() {
            var ret = [this];
            for( var i = 0; i < this.children.length; i++ )
                ret.push(...this.children[i].descendants());
            return ret;
        };
        
        this._maxChildNameLen = -1;
        this.maxChildNameLen = function() {
            if( this._maxChildNameLen >= 0 ) return this._maxChildNameLen;
            var maxLen = 2;
            if( ddl.optionEQvalue('rowkey',true) || this.isOption('rowkey') )
                maxLen = 'row_key'.length;
            if( ddl.optionEQvalue('Row Version Number','yes') || this.isOption('rowversion') )
                maxLen = 'row_version'.length;
            if( ddl.optionEQvalue('Audit Columns','yes') || this.isOption('auditcols')
            || this.isOption('audit','col') || this.isOption('audit','cols') || this.isOption('audit','columns') ) {
                let len = ddl.getOptionValue('createdcol').length;
                if( maxLen < len )
                    maxLen = len;
                len = ddl.getOptionValue('createdbycol').length;
                if( maxLen < len )
                    maxLen = len;
                len = ddl.getOptionValue('updatedcol').length;
                if( maxLen < len )
                    maxLen = len;
                len = ddl.getOptionValue('updatedbycol').length;
                if( maxLen < len )
                    maxLen = len;
            }
            if( this.fks != null )
                for( var col in this.fks ) {
                    //var parent = this.fks[col];
                    var len = col.length;
                    let refNode = ddl.find(col);
                    if( refNode != null && refNode.isMany2One() )
                        len += '_id'.length;
                    if( maxLen < len )
                        maxLen = len;
                }
            for( var i = 0; i < this.children.length; i++ ) {
                let child = this.children[i];
                if( 0 < child.children.length )
                    continue;
                let len = child.parseName().length;
                if( 0 < child.indexOf('file') )
                    len += '_FILENAME'.length;
                if( maxLen < len )
                    maxLen = len;
            }
            var cols = ddl.additionalColumns();
            for( let col in cols ) {
                let len = col.length;
                if( maxLen < len )
                    maxLen = len;
            }

            this._maxChildNameLen = maxLen;
            return maxLen;
        };
        
        function normalize( ddlLine ) {
            let ret = ddlLine;
            ret = ret.replace(/ timestamp with local time zone/gi,' tswltz');
            ret = ret.replace(/ timestamp with time zone/gi,' tswtz');
            ret = ret.replace(/ timestamp/gi,' ts');
            return ret;
        }
    
        this.content = normalize(inputLine);
        this.comment;

        // Extract annotations {key 'value', ...}
        // Only treat { as annotation start when preceded by whitespace (avoids q'{...}' alt quoting)
        this.annotations = null;
        var annStart = this.content.indexOf('{');
        if( annStart > 0 && (this.content.charAt(annStart - 1) == ' ' || this.content.charAt(annStart - 1) == '\t') ) {
            var annEnd = this.content.indexOf('}', annStart);
            if( annEnd > annStart ) {
                this.annotations = this.content.substring(annStart + 1, annEnd).trim();
                this.content = this.content.substring(0, annStart) + this.content.substring(annEnd + 1);
            }
        }

        this.getAnnotationValue = function( key ) {
            if( this.annotations == null ) return null;
            var regex = new RegExp(key + "\\s+['\"]([^'\"]*)['\"]", 'i');
            var match = this.annotations.match(regex);
            return match ? match[1] : null;
        };

        /**
         * More robust way to parse the tree node content
         * @param {*} token     to look up
         * @param {*} isPrefix  is prefix match
         * @returns
         */
        this.indexOf = function( token, isPrefix ) {
            const lowerToken = token.toLowerCase();
            for( let i = 0; i < this.src.length; i++ ) {
                const lv = this.src[i].lowerValue;
                if( isPrefix && 0 == lv.indexOf(lowerToken) )
                    return i;
                else if( lowerToken == lv )
                    return i;
            }
            return -1;
        }

        this._slashPos = undefined;
        this.occursBeforeOption = function( token, isPrefix ) {
            const tokenPos = this.indexOf(token, isPrefix);
            if( tokenPos <= 0 ) return false;
            if( this._slashPos === undefined ) this._slashPos = this.indexOf('/');
            return this._slashPos < 0 || tokenPos < this._slashPos;
        }

        this.isOption = function( token, token2 ) {
            for( let i = 2; i < this.src.length; i++ ) {
                if( token == this.src[i].lowerValue )
                    if( token2 == null || i < this.src.length-1 && token2 ==this.src[i+1].lowerValue )
                        return this.src[i-1].value == '/';
            }
            return false;
        }

        this.getOptionValue = function( option ) {
            if( this.src.length < 3 )
                return null;
            const pos = this.indexOf(option);
            if( pos < 2 || this.src[pos-1].value != '/' )
                return null;

            let ret = '';
            for( let i = pos+1; i < this.src.length && this.src[i].value != '/' && this.src[i].value != '['; i++ )
                ret += this.src[i].value;

            return ret;
        }

        this.sugarcoatName = function( from, to ) {
            let prefix = '';
            if( 0 == this.children.length ) {   // switched to this comparison style because accidental typo this.children.length = 0 is disastrous!
                if( this.parent != undefined && this.parent.colprefix != undefined )
                    prefix = this.parent.colprefix+'_';        		
            } 

            let ret = '';
            let spacer = '_';
            for( let i = from; i < to; i++ ) {
                const value = this.src[i].value;
                const qVal  = '"'+value+'"';
                if( this.src[i].type != 'constant.numeric' && value != canonicalObjectName(qVal) ) {
                    ret = this.content.substring(this.src[from].begin,this.src[to-1].end);
                    const hasPrefix = ddl != null && 0 < (ddl.getOptionValue('prefix')||'').length;
                    this.parsedName = prefix+(hasPrefix ? canonicalObjectName(ret) : amend_reserved_word(canonicalObjectName(ret)));
                    return this.parsedName;
                }
            }

            for( let i = from; i < to; i++ ) {
                if( from < i )
                    ret += spacer;
                ret += this.src[i].value;
            }

            var c = ret.charAt(0);
            if( c >= '0' && c <= '9' )
                ret = 'x'+ret;

            const hasPrefix = ddl != null && 0 < (ddl.getOptionValue('prefix')||'').length;
            this.parsedName = prefix+(hasPrefix ? canonicalObjectName(ret) : amend_reserved_word(canonicalObjectName(ret)));
            return this.parsedName;
        }
 
        this.src = lexer( this.content/*.toLowerCase()*/, false, true, '`' );
        for( let i = 0; i < this.src.length; i++ )
            this.src[i].lowerValue = this.src[i].value.toLowerCase();

        const cp = this.getOptionValue('colprefix');
        if( cp != null )
            this.colprefix = cp;
         
        this.parsedName = null;
        this.parseName = function () {  
            if( this.parsedName != null ) 
                return this.parsedName;         
            
            let nameFrom = 0;        
            let ret = this.src[0].value;
            if( ret == '>' || ret == '<' ) {
                ret = this.src[1].value;  
                nameFrom = 1;
            } 
            const  qtBegin = ret.indexOf('"');
            const  qtEnd = ret.indexOf('"', qtBegin+1);
            if( 0 <= qtBegin && qtBegin < qtEnd )
                return ret.substring(qtBegin, qtEnd+1);

            if( this.src[0].value == 'view' ) {
                return this.src[1].value;
            }
            if( 1 < this.src.length && this.src[1].value == '=' ) {
                return this.src[0].value;
            }

            let nameTo = this.src.length;

            let tmp = this.indexOf('/');
            if( 0 < tmp )
                nameTo = tmp;

            tmp = this.indexOf('[');
            if( 0 < tmp )
                nameTo = tmp;
        
            
            for( let i = 0; i < datatypes.length; i++ ) {
                let pos = this.indexOf(datatypes[i]);
                if( pos < 0 )
                    pos = this.indexOf(datatypes[i], true);
                if( 0 < pos && pos < nameTo ) {
                    nameTo = pos;
                    return this.sugarcoatName(nameFrom, nameTo); 
                }
            }

            for( let i = nameFrom; i < nameTo; i++ ) {
                const tmp = this.src[i].lowerValue;
                if( tmp.charAt(0) == 'v' && tmp.charAt(1) == 'c' ) {
                    if( tmp.charAt(2) == '(' )
                        return this.sugarcoatName(nameFrom, i); 
                    if( 0 <= tmp.charAt(2) && tmp.charAt(2) <= '9' )
                        return this.sugarcoatName(nameFrom, i); 
                }
            }

            return this.sugarcoatName(nameFrom, nameTo);
        };
        this.parseType = function( pure ) {
            if( this.children != null && 0 < this.children.length )
                return 'table';

            const src = this.src;    

            if( src[0].value == 'view' || 1 < src.length && src[1].value == '=' ) 
                return 'view';
            /*if( src[0].value == 'dv' ) 
                return 'dv';*/
                        
            if( this.parent == null )
                return 'table';
    
            var char = ddl.semantics();
            var len = 4000;	
            if( src[0].value.endsWith('_name') || src[0].value.startsWith('name') || src[0].value.startsWith('email') )
                len = ddl.getOptionValue('namelen');
            var start;
            var end;
            var values;

            const vcPos = this.indexOf('vc', true);  
            if( 0 < vcPos ) {
                start = src[vcPos].begin;
                end = src[vcPos].end;
                let varcharLen = src[vcPos].value.substring('vc'.length);
                if( '' == varcharLen ) {
                    let oParenPos = this.indexOf('(');
                    if( oParenPos == vcPos + 1 ) {
                        varcharLen = src[vcPos+2].value;
                    }
                }
                if( '' != varcharLen )
                    len = parseInt(varcharLen);
                if( src[vcPos].value.endsWith('k') )
                    if( len < 32 )
                        len = len * 1024;
                    else
                        len =  len * 1024 -1 ;   
            }
            var ret = 'varchar2('+len+char+')';
            if( pure == 'plsql' )
                ret = 'varchar2';
            //if( pure == 'fk' )
                //ret = null;
            const datePos = this.indexOf('date');
            if( this._slashPos === undefined ) this._slashPos = this.indexOf('/');
            const slashPos = this._slashPos;
            if( src[0].value.endsWith('_id') && vcPos < 0 && datePos < 0 )
                ret = 'number';
            if( src[1] && src[1].value == 'id' )
                ret = 'number';
            if( src[0].value == 'quantity' )
                ret = 'number';
            if( src[0].value.endsWith('_number') )
                ret = 'number';
            if( src[0].value.endsWith('id') && vcPos < 0 && slashPos+1 == this.indexOf('pk') )
                ret = 'number';
            if( this.occursBeforeOption('int', true) )
                ret = 'integer';

            if( 0 < vcPos ) {
                ret = 'varchar2('+len+char+')';
                if( pure == 'plsql' )
                    ret = 'varchar2';
            }

            const vector = this.vectorType('vector'); 
            if( vector != null ) 
                ret = vector;
            else {
                const vect = this.vectorType('vect'); 
                if( vect != null ) 
                    ret = vect;
            }

            const parent_child = concatNames(parent.parseName(),'_',this.parseName());

            const isDefault = this.isOption('default');

            let booleanCheck = '';
            if( src[0].value.endsWith('_yn') || src[0].value.startsWith('is_') ) {
                ret = 'varchar2(1'+ddl.semantics()+ ')';
                booleanCheck = '\n' + tab +  tab+' '.repeat(parent.maxChildNameLen()) +'constraint '+concatNames(ddl.objPrefix(),parent_child)+' check ('+this.parseName()+" in ('Y','N'))";
            }
            for( let i in boolTypes ) {
                let pos = this.indexOf(boolTypes[i]);
                if( 0 < pos ) {
                    ret = 'varchar2(1'+ddl.semantics()+ ')';
                    booleanCheck = '\n' + tab +  tab+' '.repeat(parent.maxChildNameLen()) +'constraint '+concatNames(ddl.objPrefix(),parent_child)+' check ('+this.parseName()+" in ('Y','N'))";
                    break;
                }
            } 
            const dbVer = ddl.getOptionValue('db');
            if( booleanCheck != '' && ( ddl.getOptionValue('boolean')=='native'
                                      || ddl.getOptionValue('boolean') != 'yn' && 0 < dbVer.length && 23 <= getMajorVersion(dbVer) )
            ) {
                booleanCheck = '';
                ret = 'boolean';
            }
            let isNativeBoolean = (ret === 'boolean');


            if( this.indexOf('phone_number') == 0 )
                ret = 'number';
            let from = this.indexOf('num', true);
            if( 0 < from )
                ret = 'number';
            let to = this.indexOf(')');  
            if( 0 < from && 0 < to )
                ret += this.content.substring(src[from+1].begin, src[to].end).toLowerCase();
            if( 0 <= datePos || 0 == this.indexOf('hiredate') || src[0].value.endsWith('_date') || src[0].value.startsWith('date_of_')
             || 1 < src.length && src[1].value == 'd' //0 < type.indexOf(' d') && type.indexOf(' d') == type.length-' d'.length 
             || src[0].value.startsWith('created')
             || src[0].value.startsWith('updated')
            )        		
                ret = ddl.getOptionValue('Date Data Type').toLowerCase();
            if( vcPos < 0 ) {              	
                if( this.occursBeforeOption('clob')   ) 
                    ret = 'clob';
                if( this.occursBeforeOption('blob') || this.occursBeforeOption('file') ) 
                    ret = 'blob';
                if( this.occursBeforeOption('json') ) {
                    if( dbVer != null && 0 < dbVer.length && 23 <= getMajorVersion(dbVer) )
                        ret = 'json';
                    else
                        ret = 'clob check ('+this.parseName()+' is json)';
                }
            }

            if( this.occursBeforeOption('tswltz') && slashPos !== 0  )
                ret = 'TIMESTAMP WITH LOCAL TIME ZONE'.toLowerCase();
            else if( this.occursBeforeOption('tswtz') || this.occursBeforeOption('tstz') ) 
                ret = 'TIMESTAMP WITH TIME ZONE'.toLowerCase();
            else if( this.occursBeforeOption('ts') ) 
                ret = 'TIMESTAMP'.toLowerCase();

            if( pure ) {
                if( this.isOption('fk') || 0 < this.indexOf('reference', true) ) {
                    const parent = this.refId();
                    let type = 'number';
                    if( ret == 'integer' )
                        type = ret;
                    let refNode = ddl.find(parent);
                    if( refNode != null && refNode.getExplicitPkName() != null )
                        type = refNode.getPkType();
                    return type;
                }     
                return ret;
            }	


            if( this.isOption('unique') || this.isOption('uk') ) {
                ret += '\n';  
                ret += tab +  tab+' '.repeat(parent.maxChildNameLen()) +'constraint '+concatNames(ddl.objPrefix(),parent_child,'_unq')+' unique';
            } 
            var optQuote = '\'';
            if(  ret.startsWith('integer') || ret.startsWith('number') || ret.startsWith('date')  ) 
                optQuote = '';
            if( this.isOption('default') ) {
                let value = '';
                for( let i = this.indexOf('default')+1; i < src.length; i++ ) {
                    const token = src[i].getValue();
                    if( token == '/' )
                        break;
                    if( token == '-' )
                        break;
                    if( token == '[' )
                        break;
                    value += src[i].getValue();
                }
                const sqlDateExpressions = ['sysdate', 'current_date', 'current_timestamp', 'systimestamp', 'localtimestamp'];
                if( isNativeBoolean ) {
                    let boolVal = (value.toUpperCase() === 'Y' || value.toLowerCase() === 'true') ? 'true' : 'false';
                    ret += ' default on null ' + boolVal;
                } else if( sqlDateExpressions.includes(value.toLowerCase()) )
                    ret += ' default on null ' + value;
                else
                    ret += ' default on null ' + optQuote + value + optQuote;
            }
            if( this.isOption('nn') || this.indexOf('not')+1== this.indexOf('null') )
                if( this.indexOf('pk') < 0 ) 
                    ret += ' not null';
            if( this.isOption('hidden') || this.isOption('invincible') ) 
                ret += ' invisible';
            if( !isNativeBoolean )
                ret += this.genConstraint(optQuote);
            ret += booleanCheck;
            if( this.isOption('between') ) {
                const bi = this.indexOf('between');
                const values = src[bi+1].getValue() + ' and ' + src[bi+3].getValue();
                ret +=' constraint '+concatNames(parent_child,'_bet')+'\n';
                ret +='           check ('+this.parseName()+' between '+values+')';        		
            }
            if( this.isOption('pk') ) {
                let typeModifier = ' not null';
                if( ret.startsWith('number') && ddl.optionEQvalue('pk', 'identityDataType') )
                    typeModifier = ' GENERATED BY DEFAULT ON NULL AS IDENTITY'.toLowerCase();
                if( ret.startsWith('number') && ddl.optionEQvalue('pk', 'seq') ) {
                    let objName = ddl.objPrefix()  + this.parent.parseName();
                    typeModifier = ' default on null '+objName+'_seq.NEXTVAL '.toLowerCase();
                }
                if( ret.startsWith('number') && ddl.optionEQvalue('pk', 'guid') )
                    typeModifier = ' default on null to_number(sys_guid(), \'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\') ';
                ret += typeModifier +'\n';  
                ret += tab + tab + ' '.repeat(parent.maxChildNameLen()) + 'constraint ' + concatNames(ddl.objPrefix(),parent_child,'_pk')+' primary key';
            }
            if( this.annotations != null ) {
                if( 0 <= ret.indexOf('\n') )
                    ret += '\n' + tab + tab + ' '.repeat(parent.maxChildNameLen()) + 'annotations (' + this.annotations + ')';
                else
                    ret += ' annotations (' + this.annotations + ')';
            }
            return ret;
        };

        this.vectorType = function( mnemonics ) {
            const vectPos = this.indexOf(mnemonics, true);  
            const src = this.src; 
            if( 0 < vectPos ) {
                var start = src[vectPos].begin;
                var end = src[vectPos].end;
                let dim = src[vectPos].value.substring(mnemonics.length);
                if( '' == dim ) {
                    let oParenPos = this.indexOf('(');
                    if( oParenPos == dim + 1 ) {
                        dim = src[dim+2].value;
                    }
                }
                let len = '*';
                if( '' != dim ) {  
                    let factor = 1; 
                    if( dim.endsWith('k') ) 
                        factor =  1024; 
                    dim = dim.substring(0,dim.length-1);              
                    len = parseInt(dim)*factor;
                }
                return 'vector('+len+',*,*)';
            }
            return null;
        }

        this.genConstraint = function ( optQuote ) {
            let ret = '';
            if( this.isOption('check') ) {
                let parentPref = '';
                if( parent != null )
                    parentPref = concatNames(parent.parseName(),'_');
                const parent_child = concatNames(parentPref,this.parseName());

                let offset = tab;
                if( parent != null )
                    offset = ' '.repeat(parent.maxChildNameLen());
                let constr = this.getGeneralConstraint();
                if( constr != null ) {
                    if( this.children != null && 0 < this.children.length ) {  // (general) table level constraint
                        ret += tab + 'constraint '+concatNames(ddl.objPrefix(),parent_child,'_ck');
                        ret += '  check '+ constr +',\n';    
                    } else {                     // general column level constraint
                        ret +=' constraint '+concatNames(ddl.objPrefix(),parent_child,'_ck')+'\n';
                        ret += tab +  tab+offset +'check '+ constr +'';    
                    } 
                    return ret;
                }
                const values = this.getValues('check');
                ret +=' constraint '+concatNames(ddl.objPrefix(),parent_child,'_ck')+'\n';
                ret += tab +  tab+offset +'check ('+this.parseName()+' in ('+values+'))';                    
            }
            return ret;
        }

        this.isMany2One = function() {
            return this.src[0].value == '>';
        };
        
        this.getExplicitPkName = function() {
            if( this.isOption('pk') ) {
                if( this.parseType() == 'table' )
                    return this.getOptionValue('pk');
                else
                    return this.parseName();
            }
            for( var i = 0; i < this.children.length; i++ ) {
                var child = this.children[i];
                if( child.isOption('pk') )
                    return child.parseName();
            }
            return null;
        };

        this.trimmedContent = function() {
            var ret = this.content.trim();
            var start = ret.indexOf('[');
            var end = ret.indexOf(']');
            if( this.comment == null && 0 < start ) 
                this.comment = ret.substr(start+1, end-start-1);
            if( 0 < start ) {
                ret = ret.substr(0,start) + ret.substr(end+2);
            }
            start = ret.indexOf('--');
            if( this.comment == null && 0 < start ) 
                this.comment = ret.substr(start+2);
            if( 0 < start ) {
                ret = ret.substr(0,start);
            }
            return ret.trim();
        };
        
        this.refId = function() {
            var tmp = this.trimmedContent();
            tmp = tmp.replace(/\/cascade/g,'');
            var pos = tmp.indexOf(' id ');
            if( pos < 0 ) {
                if( pos == tmp.length-' id'.length )
                    pos = tmp.indexOf(' id');
            }
            if( pos < 0 ) {
                pos = tmp.indexOf(' id');
                if( pos != tmp.length-' id'.length )
                    pos = -1;
            }
            if( pos < 0 ) {
                pos = tmp.indexOf('_id ');
                if( pos != tmp.length-'_id '.length )
                    pos = -1;
            }
            if( pos < 0 ) {
                pos = tmp.indexOf('_id');
                if( pos != tmp.length-'_id'.length )
                    pos = -1;
            }
            if( pos < 0 ) {
                pos = tmp.indexOf('Id ');
                if( pos != tmp.length-'Id '.length )
                    pos = -1;
            }
            if( 0 < pos ) {
                let ret = tmp.substr(0,pos)+'s';
                if( ddl.find(ret) != null )
                    return ret;
                ret = tmp.substr(0,pos);
                if( ddl.find(ret) != null )
                    return ret;
            }
            pos = tmp.indexOf('/fk');
            if( 0 < pos ) {
                tmp = tmp.substr(pos+'/fk'.length).trim();
                pos = tmp.indexOf('/');
                if( 0 < pos )
                    tmp = tmp.substring(0,pos).trim();
                pos = tmp.indexOf('[');
                if( 0 < pos )
                    tmp = tmp.substring(0,pos).trim();
                return tmp.replace(' ','_');
            }
            pos = tmp.indexOf('/reference');
            if( 0 < pos ) {
                tmp = tmp.substr(pos+'/reference'.length).trim();
                if( tmp.indexOf('s') == 0 )
                    tmp = tmp.substring(1).trim();
                pos = tmp.indexOf('/');
                if( 0 < pos )
                    tmp = tmp.substring(0,pos).trim();
                pos = tmp.indexOf('[');
                if( 0 < pos )
                    tmp = tmp.substring(0,pos).trim();
                return tmp.replace(' ','_');
            }
            return null;
        };

        this.getGeneralConstraint = function() { // parenthesized constraint to return verbatim, e.g. c1 /check (c1 in ('A','B','C'))
            let from = this.indexOf('check');
            if(   0 < from && this.src[from-1].value == '/' &&
                ( this.src[from+1].value == '(' || this.src[from+1].lowerValue == 'not' )
            ) {    
                let i = from+2
                for( ; i < this.src.length && this.src[i].value != '/' && this.src[i].value != '[' ; ) 
                    i++;
                let ret = this.content.substring(this.src[from+1].begin, this.src[i-1].end);
                if( ret.charAt(0) != '(' )
                    ret = '('+ret+')';
                return ret;
            }

            return null;
        }

        this.listValues = function( check_or_values ) {
            let ret = [];
            let from = this.indexOf(check_or_values);
 
            let separator = ' ';   // e.g. status /check open completed closed /values open, open, open, open, closed, completed 
            for( let i = from+1; i < this.src.length && this.src[i].value != '/' && this.src[i].value != '[' ; i++ ) 
                if( this.src[i].value == ',' ) { 
                    separator = ',';
                    break;
                } else if( this.src[i].lowerValue == 'and' ) {
                    separator = this.src[i].value;
                    break;
                }   

            if( separator == ' ' )  {
                for( let i = from+1; i < this.src.length && this.src[i].value != '/' && this.src[i].value != '[' ; i++ ) {
                    let value = this.src[i].value;
                    if( this.src[i].type == 'identifier' && value != 'null' )
                        value = "'"+ value + "'";
                    if( value.charAt(0) == '`' )
                        value = value.substring(1,value.length-1);
                    ret.push(value);
                }  
                return ret;
            }

            let aggrVal = null;
            let type = null;
            for( let i = from+1; i < this.src.length && this.src[i].value != '/' && this.src[i].value != '[' ; i++ ) {
                let value = this.src[i].value;
                let spacer = this.content.substring(this.src[i-1].end, this.src[i].begin);
                if( value == separator ) {
                    if( type == 'identifier' && aggrVal != 'null' )
                        aggrVal = "'" + aggrVal + "'";
                    ret.push(aggrVal); 
                    aggrVal = null;
                    type = null;
                    continue;
                }
                if( value == '(' )
                    continue;
                if( value == ')' )
                    continue;
                if( value.charAt(0) == '`' )
                    value = value.substring(1,value.length-1);
                //if( value.charAt(0) == '\'' )
                    //value = value.substring(1,value.length-1);
                else if( this.src[i].type == 'identifier' )
                    type = 'identifier';
                if( aggrVal == null ) 
                    aggrVal = value;
                else   
                    aggrVal += spacer+value;
                
            }
            if( type == 'identifier' )
                aggrVal = "'"+ aggrVal + "'";
            ret.push(aggrVal); 
            return ret;
        }
      

        this.getValues = function( check_or_values ) {
            let ret = '';

            const values = this.listValues(check_or_values);
            for( let i = 0; i < values.length; i++ ) {
                if( 0 < i )
                    ret += ',';
                ret += values[i];
            }
            return ret;
        }

        this.parseValues = function() {
            var values;
            if( this.isOption('check') ) {
                return this.listValues('check');
            }
            if( this.isOption('values') ) {
                return this.listValues('values');
            }
            if( this.isOption('between') ) {
                var values = this.listValues('between');
                var ret = [];
                for( var i = parseInt(values[0]); i <= parseInt(values[1]) ; i++ )
                    ret.push(i);
                return ret;
            }
            return null;
        };

        this.apparentDepth = function() {
            let chunks = this.content.split(/ |\t/);
            let depth = 0;
            for( var j = 0; j < chunks.length; j++ ) {
                var chunk = chunks[j];
                if( "\t" == chunk ) {
                    depth += this.tab;
                    continue;
                }
                if( '' == chunk  ) {
                    depth++;
                    continue;
                }
                return depth;
            }
            throw 'No alphanumerics in the node content';    
        };
        this.depth = function() {
            if( this.parent == null )
                return 0;
            return this.parent.depth()+1;
        };

        this.isLeaf = function(  ) {
            return this.children.every((c) => c.children.length == 0);
        };

        this.getGenIdColName = function () {
            if( this.parseType() != 'table' )
                return null;
            if( this.getExplicitPkName() != null )
                return null;
            if( ddl.optionEQvalue('Auto Primary Key','yes') ) {
                let colPrefix = '';
                if (this.colprefix != undefined )
                    colPrefix = this.colprefix + '_';
                if( ddl.optionEQvalue('prefixPKwithTname','yes') ) 
                    colPrefix = singular(this.parseName()) + '_';   
                return  colPrefix+'id';
            }
            return null;
        }
        this.getPkName = function () {
            let id = this.getGenIdColName();
            if( id == null ) {
                return this.getExplicitPkName();
            }
            return id;
        }
        this.getPkType = function () {
            let id = this.getGenIdColName();
            if( id == null ) {
                const cname = this.getExplicitPkName();
                return this.findChild(cname).parseType(pure=>true);
            }
            return 'number';
        }

        this.lateInitFks = function() {
            if( this.fks == null ) {
                this.fks = [];
            }

            if( !this.isMany2One() ) {
                if( this.parent != null && this.parseType() == 'table' ) {
                    const pkn = this.parent.getPkName();
                    if( pkn.indexOf(',') < 0 )
                        this.fks[singular(this.parent.parseName())+'_id']=this.parent.parseName();
                    else
                        this.fks[singular(this.parent.getPkName())]=this.parent.parseName();
                }
                for( let i = 0; i < this.children.length; i++ ) 
                    if( this.children[i].refId() != null ) {
                        this.fks[this.children[i].parseName()]=this.children[i].refId();
                    }
            } //...else   -- too lae to do here, performed earlier, during recognize()
        }

        this.singleDDL = function() {
            
            if( this.children.length == 0 && 0 < this.apparentDepth() ) {
                let pad = tab;
                if( this.parent != undefined )
                    pad += ' '.repeat(this.parent.maxChildNameLen() - this.parseName().length);
                return this.parseName()+pad+this.parseType();
            }

            this.lateInitFks();

            const objName = ddl.objPrefix()  + this.parseName();

            // SODA collection: fixed schema, skip normal column generation
            if( this.isOption('soda') ) {
                let ret = 'create table '+objName+' (\n';
                ret += tab + 'id              varchar2(255'+ddl.semantics()+') not null\n';
                ret += tab + '                constraint '+objName+'_id_pk primary key,\n';
                ret += tab + 'created_on      timestamp default sys_extract_utc(systimestamp) not null,\n';
                ret += tab + 'last_modified   timestamp default sys_extract_utc(systimestamp) not null,\n';
                ret += tab + 'version         varchar2(255'+ddl.semantics()+') not null,\n';
                ret += tab + 'json_document   json\n';
                ret += ');\n\n';
                return ret;
            }

            //var indexedColumns = [];
            var ret = '';
            if( ddl.optionEQvalue('pk', 'SEQ') && ddl.optionEQvalue('genpk', true) ) {
                ret =  ret + 'create sequence  '+objName+'_seq;\n\n';                
            }

            const _dbVer = ddl.getOptionValue('db');
            const _db23plus = _dbVer != null && 0 < _dbVer.length && 23 <= getMajorVersion(_dbVer);
            let immutableKeyword = '';
            if( this.isOption('immutable') && _db23plus )
                immutableKeyword = 'immutable ';
            ret =  ret + 'create '+immutableKeyword+'table '+objName+' (\n';
            var pad = tab+' '.repeat(this.maxChildNameLen() - 'ID'.length);

            let idColName = this.getGenIdColName();
            if( idColName != null && !this.isOption('pk') ) {
                let typeModifier = 'not null';
                if( ddl.optionEQvalue('pk', 'identityDataType') )
                    typeModifier = 'GENERATED BY DEFAULT ON NULL AS IDENTITY'.toLowerCase();
                if( ddl.optionEQvalue('pk', 'seq') )
                    typeModifier = 'default on null '+objName+'_seq.NEXTVAL '.toLowerCase();
                if( ddl.optionEQvalue('pk', 'guid') )
                    typeModifier = 'default on null to_number(sys_guid(), \'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\') ';
                ret += tab +  idColName + pad + 'number ' + typeModifier + '\n';                
                const obj_col = concatNames(ddl.objPrefix('no schema')  + this.parseName(),'_',idColName);  
                ret += tab +  tab+' '.repeat(this.maxChildNameLen()) +'constraint '+concatNames(obj_col,'_pk')+' primary key,\n';
            } else {
                let pkName = this.getExplicitPkName();
                if( pkName != null && pkName.indexOf(',') < 0 ) {
                    let pad = tab + ' '.repeat(this.maxChildNameLen() - pkName.length);
                    let type = 'number';
                    const child = this.findChild(pkName);
                    if( child != null )
                        type = child.parseType();
                    ret += tab +  pkName + pad + type + ',\n';
                }
            }
 
            for( let fk in this.fks ) {
                let parent = this.fks[fk];
                if( 0 < fk.indexOf(',') ) {
                    let refNode = ddl.find(parent);
                    var chunks = split_str(fk,', ');
                    for( var i = 0; i < chunks.length; i++ ) {
                        var col = chunks[i];
                        if( col == ',' )
                            continue;
                        const pChild = refNode.findChild(col);
                        pad = tab+' '.repeat(this.maxChildNameLen() - col.length);
                        ret += tab + col   + pad + pChild.parseType(pure=>true) + ',\n';  
                    }
                    continue;
                }
                let type = 'number';
                const attr = this.findChild(fk);
                if( attr != null )
                    type = attr.parseType('fk');		
                let refNode = ddl.find(parent);
                let _id = ''; 
                if( refNode != null ) {
                    const rname = refNode.getExplicitPkName();  
                    if( rname != null && rname.indexOf(',') < 0 )
                        type = refNode.getPkType();  
                } else {
                    refNode = ddl.find(fk);
                    if( refNode.isMany2One() & !fk.endsWith('_id') ) {
                        parent = fk;
                        fk = singular(fk);
                        _id = '_id';  
                    }
                }
                pad = tab+' '.repeat(this.maxChildNameLen() - fk.length);
                ret += tab + fk + _id  + pad + type;
                const refPrefix = ddl.find(parent) != null ? ddl.objPrefix() : '';
                if( refNode.line < this.line || refNode.isMany2One() ) {
                    ret += tab + tab+' '.repeat(this.maxChildNameLen()) + 'constraint '+objName+'_'+fk+'_fk\n';
                    let onDelete = '';
                    if( this.isOption('cascade'))
                        onDelete = ' on delete cascade';
                    else if( this.isOption('setnull'))
                        onDelete = ' on delete set null';
                    let	notNull = '';
                    for( let c in this.children ) {
                        let child = this.children[c];
                        if( fk == child.parseName() )  {
                            if( child.isOption('nn') || child.isOption('notnull')  )
                                notNull = ' NOT NULL'.toLowerCase();
                            if( child.isOption('cascade')  )
                                onDelete = ' on delete cascade';
                            else if( this.isOption('setnull'))
                                onDelete = ' on delete set null';
                            break;
                        }
                    }
                    ret += tab + tab+' '.repeat(this.maxChildNameLen()) + 'references '+refPrefix+parent+onDelete+notNull+',\n';
                } else {
                    ret += ',\n';
                    const alter = 'alter table '+objName+' add constraint '+objName+'_'+fk+'_fk foreign key ('+fk+') references '+refPrefix+parent+';\n'
                    if( !ddl.postponedAltersSet.has(alter) ) {
                        ddl.postponedAlters.push(alter);
                        ddl.postponedAltersSet.add(alter);
                    }
                }
            }

            if( ddl.optionEQvalue('rowkey',true) || this.isOption('rowkey') ) {
                let pad = tab+' '.repeat(this.maxChildNameLen() - 'ROW_KEY'.length);
                ret += tab +  'row_key' + pad + 'varchar2(30'+ddl.semantics()+ ')\n';              	
                ret += tab +  tab+' '.repeat(this.maxChildNameLen()) +'constraint '+objName+'_row_key_unq unique not null,\n';
            }            	

            for( let i = 0; i < this.children.length; i++ ) {
                let child = this.children[i];
                if( idColName != null && child.parseName() == 'id' )
                    continue;
                if( 0 < child.children.length ) {
                    continue;
                }
                if( child.refId() == null ) {
                    if( child.parseName() == this.getExplicitPkName() )
                        continue; 
                    ret += tab + child.singleDDL() +',\n';
                    if( 0 < child.indexOf('file') ) {
                        const col = child.parseName().toUpperCase();
                        let extraCol  = col+'_FILENAME';
                        let pad = tab+' '.repeat(this.maxChildNameLen() - extraCol.length);
                        ret += tab +  extraCol.toLowerCase() + pad + 'varchar2(255'+ddl.semantics()+ '),\n';  
                        extraCol  = col+'_MIMETYPE';
                        pad = tab+' '.repeat(this.maxChildNameLen() - extraCol.length);
                        ret += tab +  extraCol.toLowerCase() + pad + 'varchar2(255'+ddl.semantics()+ '),\n';  
                        extraCol  = col+'_CHARSET';
                        pad = tab+' '.repeat(this.maxChildNameLen() - extraCol.length);
                        ret += tab +  extraCol.toLowerCase() + pad + 'varchar2(255'+ddl.semantics()+ '),\n';  
                        extraCol  = col+'_LASTUPD';
                        pad = tab+' '.repeat(this.maxChildNameLen() - extraCol.length);
                        ret += tab +  extraCol.toLowerCase() + pad + ddl.getOptionValue('Date Data Type').toLowerCase() + ',\n';  
                    }
                } 
            }
            if( ddl.optionEQvalue('rowVersion','yes') || this.isOption('rowversion') ) {
                let pad = tab+' '.repeat(this.maxChildNameLen() - 'row_version'.length);
                ret += tab +  'row_version' + pad + 'integer not null,\n';              	
            }            	
            if( ddl.optionEQvalue('Audit Columns','yes') || this.isOption('auditcols')
                      || this.isOption('audit','col') || this.isOption('audit','cols') || this.isOption('audit','columns') ) {
                let auditDateType = ddl.getOptionValue('auditdate');
                if( auditDateType == null || auditDateType == '' )
                    auditDateType = ddl.getOptionValue('Date Data Type');
                auditDateType = auditDateType.toLowerCase();
                let created = ddl.getOptionValue('createdcol');
                let pad = tab+' '.repeat(this.maxChildNameLen() - created.length);
                ret += tab +  created + pad + auditDateType + ' not null,\n';
                let createdby = ddl.getOptionValue('createdbycol');
                pad = tab+' '.repeat(this.maxChildNameLen() - createdby.length);
                ret += tab +  createdby + pad + 'varchar2(255'+ddl.semantics()+') not null,\n';
                let updated = ddl.getOptionValue('updatedcol');
                 pad = tab+' '.repeat(this.maxChildNameLen() - updated.length);
                ret += tab +  updated + pad + auditDateType + ' not null,\n';
                let updatedby = ddl.getOptionValue('updatedbycol');
                pad = tab+' '.repeat(this.maxChildNameLen() - updatedby.length);
                ret += tab +  updatedby + pad + 'varchar2(255'+ddl.semantics()+') not null,\n';
            }            	
            var cols = ddl.additionalColumns();
            for( let col in cols ) {
                var type = cols[col];
                pad = tab+' '.repeat(this.maxChildNameLen() - col.length);
                ret += tab +  col.toUpperCase() + pad + type + ' not null,\n';  
            }
            ret += this.genConstraint();
            if( ret.lastIndexOf(',\n') == ret.length-2 )
                ret = ret.substring(0,ret.length-2)+'\n';
            let tableAnnotations = this.annotations != null ? '\nannotations (' + this.annotations + ')' : '';
            let compressClause = '';
            if( ddl.optionEQvalue('compress','yes') || this.isOption('compress') )
                compressClause = _db23plus ? ' row store compress advanced' : ' compress';
            let immutableSuffix = (immutableKeyword != '') ? ' no drop no delete' : '';
            ret += ')'+compressClause+tableAnnotations+immutableSuffix+';\n\n';
            
            if( this.isOption('audit') && !this.isOption('auditcols') &&
                           !this.isOption('audit','col') && !this.isOption('audit','cols') && !this.isOption('audit','columns') ) {
                ret += 'audit all on '+objName+';\n\n';
            }

            if( this.isOption('flashback') || this.isOption('fda') ) {
                let archiveName = this.getOptionValue('flashback') || this.getOptionValue('fda') || '';
                archiveName = archiveName.trim();
                ret += 'alter table '+objName+' flashback archive'+(0 < archiveName.length ? ' '+archiveName : '')+';\n\n';
            }
     
            for( let fk in this.fks ) {
                if( 0 < fk.indexOf(',') ) {
                    var parent = this.fks[fk];
                    ret +=  'alter table '+objName+' add constraint '+parent+'_'+objName+'_fk foreign key ('+fk+') references '+parent+';\n\n';
                }
            }
            let num = 1;
            for( let fk in this.fks ) {
                if( !this.isMany2One() ) {
                    var parent = this.fks[fk];
                    var ref = parent;
                    var col = fk;
                    if( col == null )
                        col = singular(ref)+'_id';
                    if( num == 1 )    
                        ret += '-- table index\n';
                    ret += 'create index '+objName+'_i'+(num++)+' on '+objName+' ('+col+');\n\n';
                } else {

                }
            }
 
            let cut = this.getOptionValue('pk');
            if( cut /*!= null*/ ) {
                ret += 'alter table '+objName+' add constraint '+objName+'_pk primary key ('+cut+');\n\n';
            }

            cut = this.getOptionValue('unique');
            if( cut == null )
                cut = this.getOptionValue('uk');
            if( cut != null ) {
                ret += 'alter table '+objName+' add constraint '+objName+'_uk unique ('+cut+');\n\n';
            }

            //var j = 1;
            for( let i = 0; i < this.children.length; i++ ) {
                var child = this.children[i];
                if( child.isOption('idx') || child.isOption('index')  ) {
                    if( num == 1 )    
                        ret += '-- table index\n';
                    ret += 'create index '+objName+'_i'+(num++)+' on '+objName+' ('+child.parseName()+');\n'; 
                }
            }
            
            if( _db23plus ) {
                for( let i = 0; i < this.children.length; i++ ) {
                    let child = this.children[i];
                    if( child.children.length == 0 && child.parseType(true).startsWith('vector') ) {
                        ret += 'create vector index '+objName+'_vi'+(num++)+' on '+objName+' ('+child.parseName()+')\n';
                        ret += '    organization neighbor partitions\n';
                        ret += '    with distance cosine;\n\n';
                    }
                }
            }

            var tableComment = this.getAnnotationValue('DESCRIPTION') || this.comment;
            if( tableComment != null )
                ret += 'comment on table '+objName+' is \''+tableComment+'\';\n';
            for( let i = 0; i < this.children.length; i++ ) {
                let child = this.children[i];
                var colComment = child.getAnnotationValue('DESCRIPTION') || child.comment;
                if( colComment != null && child.children.length == 0 )
                    ret += 'comment on column '+objName+'.'+child.parseName()+' is \''+colComment+'\';\n';
            }
            ret += '\n';
            
            return ret;
        };

        this.toDDL = function() {
            if (this.parseType() == 'view' || this.parseType() == 'dv' ) 
                return ''; 

            var tables = this.orderedTableNodes();
            let ret = '';
            for( let i = 0; i < tables.length; i++ ) {
                ret += tables[i].singleDDL();
            }
            return ret;
        } 

        this.orderedTableNodes = function() {
            var ret = [this,];
            const descendants = this.descendants();
            for( let i = 1; i < descendants.length; i++ ) {
                var desc = descendants[i];
                if( 0 == desc.children.length ) 
                    continue;
                if( desc.isMany2One() ) {
                    if( !desc.isContainedIn(ret) )
                        ret.unshift(desc);
                } else if( !desc.isContainedIn(ret) )
                    ret.push(desc);
            }
            return ret;
        }
        
        this.isContainedIn = function( nodes ) {
            for( const i in nodes ) 
                if( nodes[i].parseName() == this.parseName() )
                    return true;
            return false;    
        }

        this.generateDrop = function() {
            let objName = ddl.objPrefix()  + this.parseName();
            const dbVer = ddl.getOptionValue('db');
            const ifExists = dbVer != null && 0 < dbVer.length && 23 <= getMajorVersion(dbVer) ? 'if exists ' : '';
            let ret = '';
            if( this.parseType() == 'view' )
                ret = 'drop view '+ifExists+objName+';\n';
            if( this.parseType() == 'table' ) {
                ret = 'drop table '+ifExists+objName+' cascade constraints;\n';
                if( ddl.optionEQvalue('api','yes') )
                    ret+= 'drop package '+ifExists+objName+'_api;\n';
                if( ddl.optionEQvalue('pk','SEQ') )
                    ret+= 'drop sequence '+ifExists+objName+'_seq;\n';
            }
            return ret.toLowerCase();
        };

        this.generateView = function() {
            if( this.parseType() != 'view' && this.parseType() != 'dv' ) 
                return '';

            if( ddl.optionEQvalue('Duality View','yes') || this.parseType() == 'dv' ) {
                try {
                    return this.generateDualityView();
                } catch ( e ) {
                    if( e.message == this.one2many2oneUnsupoported  )
                        return '';
                    throw e;
                }
            }
            let objName = ddl.objPrefix()  + this.parseName();
            var chunks = this.src;
            // Build alias map and cache table lookups (avoid repeated ddl.find calls)
            let aliasMap = {};
            let tblCache = {};
            for( let i = 2; i < chunks.length; i++ ) {
                aliasMap[chunks[i].value] = amend_reserved_word(chunks[i].value);
                tblCache[chunks[i].value] = ddl.find(chunks[i].value);
            }
            var ret = 'create or replace view ' +objName;
            if( this.annotations != null )
                ret += '\nannotations (' + this.annotations + ')';
            ret += ' as\n';
            ret += 'select\n';
            var maxLen = 0;
            for( var i = 2; i < chunks.length; i++ ) {
                let tbl = tblCache[chunks[i].value];
                if( tbl == null )
                    return '';
                let alias = aliasMap[chunks[i].value];
                var len = (alias+'.id').length;
                if( maxLen < len )
                    maxLen = len;
                for( var j = 0; j < tbl.children.length; j++ ) {
                    var child = tbl.children[j];
                    len = (alias+'.'+child.parseName()).length;
                    if( maxLen < len )
                        maxLen = len;
                }
            }
            var colCnts = {};
            for( let i = 2; i < chunks.length; i++ ) {
                let tbl = tblCache[chunks[i].value];
                if( tbl == null )
                    continue;
                for( let j = 0; j < tbl.children.length; j++ ) {
                    let child = tbl.children[j];
                    var col = child.parseName();
                    var cnt = colCnts[col];
                    if( cnt == null )
                        cnt = 0;
                    colCnts[col] = cnt+1;
                }
            }
            // Count auto-generated ID aliases to detect duplicates with child columns
            for( let i = 2; i < chunks.length; i++ ) {
                let idAlias = singular(chunks[i].value) + '_id';
                let cnt = colCnts[idAlias] || 0;
                colCnts[idAlias] = cnt + 1;
            }
            // Determine which tables have /trans columns
            let tblTransCols = {};
            for( let i = 2; i < chunks.length; i++ ) {
                let tbl = tblCache[chunks[i].value];
                if( tbl != null && tbl.getTransColumns ) {
                    let tc = tbl.getTransColumns();
                    if( tc.length > 0 ) {
                        let transNames = {};
                        for( let t = 0; t < tc.length; t++ )
                            transNames[tc[t].parseName()] = true;
                        tblTransCols[chunks[i].value] = transNames;
                    }
                }
            }

            for( let i = 2; i < chunks.length; i++ ) {
                let tbl = tblCache[chunks[i].value];
                if( tbl == null )
                    continue;
                let tblName = chunks[i].value;
                let alias = aliasMap[tblName];
                let transNames = tblTransCols[tblName] || {};
                let pad = ' '.repeat(maxLen - (alias+'.id').length);
                ret += tab + alias+'.id'+tab+pad+singular(tblName)+'_id,\n';
                for( let j = 0; j < tbl.children.length; j++ ) {
                    let child = tbl.children[j];
                    if( 0 == child.children.length ) {
                        let cname = child.parseName();
                        var disambiguator = '';
                        if( 1< colCnts[cname] )
                            disambiguator = singular(tblName)+'_';
                        if( transNames[cname] ) {
                            let tAlias = 't_' + tblName;
                            let expr = 'coalesce('+tAlias+'.trans_'+cname+', '+alias+'.'+cname+')';
                            ret += tab + expr + tab + disambiguator+cname+',\n';
                        } else {
                            pad = ' '.repeat(maxLen - (alias+'.'+cname).length);
                            ret += tab + alias+'.'+cname+tab+pad+disambiguator+cname+',\n';
                        }
                    }
                }
                if( ddl.optionEQvalue('rowVersion','yes') || tbl.isOption('rowversion') ) {
                    let pad = tab+' '.repeat(tbl.maxChildNameLen() - 'row_version'.length);
                    ret += tab + alias+'.'+ 'row_version' + pad + singular(tblName)+'_'+ 'row_version,\n';
                }
                if( ddl.optionEQvalue('rowkey','yes') || tbl.isOption('rowkey') ) {
                    let pad = tab+' '.repeat(tbl.maxChildNameLen() - 'ROW_KEY'.length);
                    ret += tab + alias+'.'+ 'ROW_KEY' + pad + singular(tblName)+'_'+ 'ROW_KEY,\n';
                }
                if( ddl.optionEQvalue('Audit Columns','yes') || tbl.isOption('auditcols')
                   || tbl.isOption('audit','col') || tbl.isOption('audit','cols') || tbl.isOption('audit','columns') ) {
                    let created = ddl.getOptionValue('createdcol');
                    let pad = tab+' '.repeat(tbl.maxChildNameLen() - created.length);
                    ret += tab + alias+'.'+  created + pad + singular(tblName)+'_'+ created+',\n';
                    let createdby = ddl.getOptionValue('createdbycol');
                    pad = tab+' '.repeat(tbl.maxChildNameLen() - createdby.length);
                    ret += tab + alias+'.'+  createdby + pad + singular(tblName)+'_'+  createdby+',\n';
                    let updated = ddl.getOptionValue('updatedcol');
                    pad = tab+' '.repeat(tbl.maxChildNameLen() - updated.length);
                    ret += tab + alias+'.'+  updated + pad + singular(tblName)+'_'+  updated+',\n';
                    let updatedby = ddl.getOptionValue('updatedbycol');
                    pad = tab+' '.repeat(tbl.maxChildNameLen() - updatedby.length);
                    ret += tab + alias+'.'+  updatedby + pad + singular(tblName)+'_'+ updatedby + ',\n';
                }
            }
            if( ret.lastIndexOf(',\n') == ret.length-2 )
                ret = ret.substr(0,ret.length-2)+'\n';
            // Build set of view table names for quick lookup
            let viewTableNames = {};
            for( let i = 2; i < chunks.length; i++ )
                viewTableNames[chunks[i].value] = true;
            // Collect join conditions: joinConditions[childTable] = [{fkCol, parentTable}]
            let joinConditions = {};
            for( let i = 2; i < chunks.length; i++ ) {
                let nameA = chunks[i].value;
                let nodeA = tblCache[nameA];
                if( nodeA == null )
                    continue;
                for( let k in nodeA.fks ) {
                    let parent = nodeA.fks[k];
                    if( viewTableNames[parent] && parent != nameA ) {
                        if( !joinConditions[nameA] )
                            joinConditions[nameA] = [];
                        joinConditions[nameA].push({ fkCol: k, parentTable: parent });
                    }
                }
            }
            // Topological sort: base tables first (no FKs to other view tables), then dependents
            let emitted = {};
            let sortedTables = [];
            // First pass: tables with no join conditions (base tables)
            for( let i = 2; i < chunks.length; i++ ) {
                let name = chunks[i].value;
                if( !joinConditions[name] ) {
                    sortedTables.push(name);
                    emitted[name] = true;
                }
            }
            // Second pass: tables with join conditions (all parents must be emitted)
            let remaining = [];
            for( let i = 2; i < chunks.length; i++ ) {
                let name = chunks[i].value;
                if( joinConditions[name] )
                    remaining.push(name);
            }
            while( remaining.length > 0 ) {
                let progress = false;
                let next = [];
                for( let r = 0; r < remaining.length; r++ ) {
                    let name = remaining[r];
                    let conds = joinConditions[name];
                    let allParentsEmitted = true;
                    for( let c = 0; c < conds.length; c++ ) {
                        if( !emitted[conds[c].parentTable] ) {
                            allParentsEmitted = false;
                            break;
                        }
                    }
                    if( allParentsEmitted ) {
                        sortedTables.push(name);
                        emitted[name] = true;
                        progress = true;
                    } else {
                        next.push(name);
                    }
                }
                remaining = next;
                if( !progress ) {
                    // Circular dependency fallback: emit remaining in original order
                    for( let r = 0; r < remaining.length; r++ ) {
                        sortedTables.push(remaining[r]);
                        emitted[remaining[r]] = true;
                    }
                    break;
                }
            }
            // Generate FROM clause with ANSI JOINs
            ret += 'from\n';
            let transContext = ddl.getOptionValue('transcontext');
            for( let si = 0; si < sortedTables.length; si++ ) {
                let tblName = sortedTables[si];
                let alias = aliasMap[tblName];
                let tblExpr = alias;
                if( ddl.objPrefix() != null && ddl.objPrefix() != '' )
                    tblExpr = ddl.objPrefix() + tblName + ' ' + alias;
                if( si == 0 ) {
                    ret += tab + tblExpr + '\n';
                } else if( joinConditions[tblName] ) {
                    let conds = joinConditions[tblName];
                    ret += tab + 'left join ' + tblExpr + '\n';
                    for( let c = 0; c < conds.length; c++ ) {
                        let aliasB = aliasMap[conds[c].parentTable];
                        let prefix = (c == 0) ? 'on ' : 'and ';
                        ret += tab + tab + prefix + alias + '.' + conds[c].fkCol + ' = ' + aliasB + '.id\n';
                    }
                } else {
                    ret += tab + 'cross join ' + tblExpr + '\n';
                }
                // Add translation table LEFT JOIN immediately after the base table
                if( tblTransCols[tblName] ) {
                    let tblNode = tblCache[tblName];
                    let transName = ddl.objPrefix() + tblName + '_trans';
                    let tAlias = 't_' + tblName;
                    let fkCol = singular(tblName) + '_id';
                    let pkCol = tblNode.getGenIdColName() || tblNode.getExplicitPkName() || 'id';
                    ret += tab + 'left join ' + transName + ' ' + tAlias + '\n';
                    ret += tab + tab + 'on ' + tAlias + '.' + fkCol + ' = ' + alias + '.' + pkCol + '\n';
                    ret += tab + tab + 'and ' + tAlias + '.language_code = ' + transContext + '\n';
                }
            }
            ret = ret.toLowerCase();
            if( ret.endsWith('\n') )
                ret = ret.trimEnd(); 
            if( !ret.endsWith('\n') )
                ret += '\n';         
            ret += '/\n'; 
            return ret.toLowerCase();
        };

        this.restEnable = function() {
            if( this.parseType() != 'table' ) 
                return '';
            if( !this.isOption('rest') ) 
                return '';
            let name = this.parseName();
            const isQuoted = 0 == name.indexOf('"');
            let objName = ddl.objPrefix()  + name;
            if( isQuoted )
                objName = ddl.objPrefix()  + name.substring(1, name.length-1);
            else
                objName = (ddl.objPrefix()  + name).toUpperCase();
            return "begin\n" 
                    + tab + "ords.enable_object(p_enabled=>TRUE, p_object=>'"+objName+"');\n"
                    + "end;\n/\n"
            ;
        }


        this.generateTrigger = function() {
            if( this.parseType() != 'table' )
                return '';
            if( this.isOption('soda') )
                return '';
            let editionable = '';
            if( ddl.optionEQvalue('editionable','yes') )
                editionable = ' editionable';
            let objName = ddl.objPrefix()  + this.parseName();
            var ret = 'create or replace'+editionable+' trigger '+ objName.toLowerCase() +'_BIU\n'.toLowerCase();
            ret += this.isOption('immutable') ? '    before insert\n' : '    before insert or update\n';
            ret += '    on '+ objName.toLowerCase() +'\n';
            ret += '    for each row\n';

           if( ddl.optionEQvalue('rowkey','yes') || this.isOption('rowkey') )  {
                ret += `declare
    function compress_int (n in integer ) return varchar2
    as
        ret       varchar2(30);
        quotient  integer;
        remainder integer;
        digit     char(1);
    begin
        ret := null; quotient := n;
        while quotient > 0
        loop
            remainder := mod(quotient, 10 + 26);
            quotient := floor(quotient  / (10 + 26));
            if remainder < 26 then
                digit := chr(ascii('A') + remainder);
            else
                digit := chr(ascii('0') + remainder - 26);
            end if;
            ret := digit || ret;
        end loop ;
        if length(ret) < 5 then ret := lpad(ret, 4, 'A'); end if ;
        return upper(ret);
    end compress_int;
`           ;}

            ret += 'begin\n';
            var OK = false;
            var user = 'user';
            if( ddl.optionEQvalue('apex','yes') ) {
                user = 'coalesce(sys_context(\'APEX$SESSION\',\'APP_USER\'),user)';
            }
            if( ddl.optionEQvalue('rowkey','yes') || this.isOption('rowkey') )  {
                ret += '    if inserting then\n';
                ret += '        :new.row_key := compress_int(row_key_seq.nextval);\n';
                ret += '    end if;\n';
                OK = true;
            }
            for( var i = 0; i < this.children.length; i++ ) {
                var child = this.children[i]; 
                let method = null;
                if( 0 < child.content.indexOf('/lower') ) 
                    method = 'LOWER'.toLowerCase();
                else if( 0 < child.content.indexOf('/upper') ) 
                    method = 'UPPER'.toLowerCase();
                if( method == null )
                    continue;
                ret += '    :new.'+child.parseName().toLowerCase()+' := '+method+'(:new.'+child.parseName().toLowerCase()+');\n';
                OK = true;
            }
            if( ddl.optionEQvalue('Row Version Number','yes') || this.isOption('rowversion') )  {
                ret += '    if inserting then\n';
                ret += '        :new.row_version := 1;\n';
                if( !this.isOption('immutable') ) {
                    ret += '    elsif updating then\n';
                    ret += '        :new.row_version := NVL(:old.row_version, 0) + 1;\n';
                }
                ret += '    end if;\n';
                OK = true;
            }
            if( ddl.optionEQvalue('Audit Columns','yes') || this.isOption('auditcols') || this.isOption('audit','col') || this.isOption('audit','cols') || this.isOption('audit','columns') ) {
                let auditDateType = ddl.getOptionValue('auditdate') || ddl.getOptionValue('Date Data Type');
                let sysDateFn = (auditDateType.toLowerCase().indexOf('timestamp') >= 0) ? 'systimestamp' : 'sysdate';
                ret += '    if inserting then\n';
                ret += '        :new.'+ddl.getOptionValue('createdcol')+' := '+sysDateFn+';\n';
                ret += '        :new.'+ddl.getOptionValue('createdbycol')+' := '+user+';\n'.toLowerCase();
                ret += '    end if;\n';
                ret += '    :new.'+ddl.getOptionValue('updatedcol')+' := '+sysDateFn+';\n';
                ret += '    :new.'+ddl.getOptionValue('updatedbycol')+' := '+user+';\n'.toLowerCase();
                OK = true;
            }
            /*if( ddl.optionEQvalue('genpk','yes') perhaps 'no'?
                && ddl.optionEQvalue('pk','guid')  
            )  {
                ret += '    if :new.id is null then\n';
                ret += '        :new.id := to_number(sys_guid(), \'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\');\n';
                ret += '    end if;\n';
                OK = true;
            }*/
            var cols = ddl.additionalColumns();
            for( var col in cols ) {
                var type = cols[col];
                ret += '    if :new.'+col+' is null then\n';
                if( type.startsWith('INT') )
                    ret += '        '+col+' := 0;\n';
                else
                    ret += '        '+col+' := \'N/A\';\n';
                ret += '    end if;\n';
                OK = true;
            }
            if( !OK )
                return '';
            ret += 'end ' + objName .toLowerCase()+ '_BIU;\n/\n\n'.toLowerCase();
            return ret;
        };


        this.generateImmutableTrigger = function() {
            if( this.parseType() != 'table' )
                return '';
            if( !this.isOption('immutable') )
                return '';
            const dbVer = ddl.getOptionValue('db');
            if( dbVer != null && 0 < dbVer.length && 23 <= getMajorVersion(dbVer) )
                return '';
            let objName = ddl.objPrefix()  + this.parseName();
            let ret = 'create or replace trigger trg_'+ objName.toLowerCase() +'_insertonly\n';
            ret += '    before update or delete\n';
            ret += '    on '+ objName.toLowerCase() +'\n';
            ret += 'begin\n';
            ret += '    raise_application_error(-20055, \''+ objName.toLowerCase() +' is immutable\');\n';
            ret += 'end;\n/\n\n';
            return ret;
        };

        this.procDecl = function( kind /* get, insert, update */ ) {
            let modifier = '';
            if( kind != 'get' )
                modifier = ' default null';
            let mode = 'out';
            if( kind != 'get' )
                mode = ' in';
            let ret =  tab+'procedure '+kind+'_row (\n'; 
            let idColName = this.getGenIdColName();
            if( idColName == null ) {
                idColName = this.getExplicitPkName();
            }
            ret += tab+tab+'p_'+idColName+'        in  number'+modifier;
            for( var fk in this.fks ) {	
                let parent = this.fks[fk];				
                let type = 'number';
                let refNode = ddl.find(parent);
                if( refNode != null && refNode.getExplicitPkName() != null )
                    type = refNode.getPkType();
                //pad = tab+tab+' '.repeat(this.maxChildNameLen() - fk.length);
                ret += ',\n';
                ret += tab+tab+'P_'+fk+'   '+mode+'  '+type+modifier;
            }
            for( let i = 0; i < this.children.length; i++ ) {
                var child = this.children[i]; 
                if( child.refId() != null  )
                    continue;
                if( child.children.length != 0 ) 
                    continue;
                ret += ',\n';
                ret += tab+tab+'P_'+child.parseName()+'   '+mode+'  '+child.parseType('plsql')+modifier;
            }
            ret += '\n    )';
            return ret;
        };
        this.procBody = function( kind /* get, insert, update */ ) {
            let idColName = this.getGenIdColName();
            if( idColName == null ) {
                idColName = this.getExplicitPkName();
            }
            let objName = ddl.objPrefix()  + this.parseName();
            let ret =    tab+'is \n';
            ret +=    tab+'begin \n';
            let prelude =    tab+tab+'for c1 in (select * from '+objName+' where '+idColName+' = p_'+idColName+') loop \n';
            if( kind == 'insert' ) {
                prelude =    tab+tab+'insert into '+objName+' ( \n';
                prelude += tab+tab+tab+idColName;
            }
            if( kind == 'update' ) {
                prelude =    tab+tab+'update  '+objName+' set \n';
                prelude += tab+tab+tab+idColName+' = p_'+idColName;
            }
            ret += prelude;
            for( let fk in this.fks ) {	
                let parent = this.fks[fk];				
                let type = 'number';
                let refNode = ddl.find(parent);
                if( refNode != null && refNode.getExplicitPkName() != null )
                    type = refNode.getPkType();
                //pad = tab+tab+' '.repeat(this.maxChildNameLen() - fk.length);
                if( kind == 'insert' || kind == 'update' ) 
                    ret += ',\n';
                let row = tab+tab+tab+'P_'+fk+' := c1.'+fk+';\n';	
                if( kind == 'insert' ) 
                    row = tab+tab+tab+fk;
                if( kind == 'update' ) 
                    row = tab+tab+tab+fk+' = P_'+fk;	
                ret += row;
            }
            for( var i = 0; i < this.children.length; i++ ) {
                var child = this.children[i]; 
                if( child.refId() != null  )
                    continue;
                if( child.children.length != 0 ) 
                    continue;
                if( kind == 'insert' || kind == 'update' ) 
                    ret += ',\n';
                let row = tab+tab+tab+'P_'+child.parseName().toLowerCase()+' := c1.'+child.parseName().toLowerCase()+';\n';	
                if( kind == 'insert' ) 
                    row = tab+tab+tab+child.parseName().toLowerCase();
                if( kind == 'update' ) 
                    row = tab+tab+tab+child.parseName().toLowerCase()+' = P_'+child.parseName().toLowerCase();	
                ret += row;
            }
            if( kind == 'insert' ) {
                ret +=    '\n'+tab+tab+') values ( \n';
                ret +=    tab+tab+tab+'p_'+idColName;
                for( let fk in this.fks ) {	
                    ret += ',\n';
                    ret += tab+tab+tab+'p_'+fk;
                }
                for( let i = 0; i < this.children.length; i++ ) {
                    let child = this.children[i]; 
                    if (child.refId() != null  )
                        continue;
                    if( child.children.length != 0 ) 
                        continue;
                    ret += ',\n';
                    ret += tab+tab+tab+'p_'+child.parseName();
                }
            }
            let finale = '\n        end loop;\n';
            if( kind == 'insert' )
                finale = '\n'+tab+tab+');';
            if( kind == 'update' )
                finale = '\n'+tab+tab+'where '+idColName+' = p_'+idColName+';';
            ret += finale;
            ret += '\n'+tab+'end '+kind+'_row;\n ';
            ret += '\n ';
            return ret;
        };
        this.generateTAPI = function() {
            if( this.children.length == 0 ) 
                return '';
            let objName = ddl.objPrefix()  + this.parseName();
            var ret = 'create or replace package '+ objName.toLowerCase() +'_API\nis\n\n'.toLowerCase();
            ret += this.procDecl('get'); 
            ret += ';\n\n';
            ret += this.procDecl('insert'); 
            ret += ';\n\n';
            ret += this.procDecl('update'); 
            ret += ';\n\n';
            let idColName = this.getGenIdColName();
            if( idColName == null ) {
                idColName = this.getExplicitPkName();
            }
            ret += '    procedure delete_row (\n'+
                '        p_'+idColName+'              in number\n'+
                '    );\n'+
                'end '+objName.toLowerCase()+'_api;\n'+
                '/\n\n';
            ret += 'create or replace package body '+ objName.toLowerCase() +'_API\nis\n\n'.toLowerCase();
            ret += this.procDecl('get'); 
            ret += '\n';
            ret += this.procBody('get');

            ret += this.procDecl('insert'); 
            ret += '\n';
            ret += this.procBody('insert'); 

            ret += this.procDecl('update'); 
            ret += '\n';
            ret += this.procBody('update'); 

            ret += '    procedure delete_row (\n';
            ret += '        p_'+idColName+'              in number\n';
            ret += '    )\n';
            ret += '    is\n';
            ret += '    begin\n';
            ret += '        delete from '+objName.toLowerCase()+' where '+idColName+' = p_'+idColName+';\n';
            ret += '    end delete_row;\n';
            ret += 'end '+objName.toLowerCase()+'_api;\n';
            ret += '/\n';
            return ret.toLowerCase();
        };

        this.cardinality = function() {
            let start = this.isOption('insert');
            if( 0 < start ) {
                const pos = this.indexOf('insert');
                let ret =  parseInt(this.src[pos+1].value);
                const limit = ddl.getOptionValue('datalimit');
                if( limit < ret )
                    ret = limit;
                return ret;
            }
            return 0;
        }

        this.generateData = function( dataObj ) {
            resetSeed();
            if( ddl.optionEQvalue('inserts',false) )
                return '';
            const tab2inserts = this.inserts4tbl(dataObj);
            const tables = this.orderedTableNodes();
            let ret = '';
            for( let i = 0; i < tables.length; i++ ) {
                const objName = ddl.objPrefix()  + tables[i].parseName();
                const inserts = tab2inserts[objName];
                if( inserts != null )
                    ret += inserts;
            }
            return ret;
        }
            
        this.inserts4tbl = function( dataObj ) {

            let tab2inserts = {};

            if( ddl.optionEQvalue('inserts',false) )
                return '';
            
            const objName = ddl.objPrefix()  + this.parseName();
            let insert = '';

            let pkName = null;
            let pkValue = null;

            for( let i = 0; i < this.cardinality(); i++ ) {
                let elem = null;
                if( dataObj != null ) {
                    const tbl = dataObj[objName];
                    if( tbl != null && Array.isArray(tbl) ) {
                        const record = tbl[i];
                        elem = record;
                    }
                }

                insert += 'insert into '+objName+' (\n';
                    
                let idColName = this.getGenIdColName();
                if( idColName != null ) {
                    pkName = idColName;
                    insert += tab + pkName +',\n';
                } else {
                    let pkName = this.getExplicitPkName();
                    if( pkName != null ) {
                        insert += tab + pkName +',\n';
                    }
                }
                for( let fk in this.fks ) {
                    let parent = this.fks[fk];				
                    let refNode = ddl.find(parent);
                    let _id = '';    
                    if( refNode == null ) {
                        refNode = ddl.find(fk);
                        if( refNode.isMany2One() & !fk.endsWith('_id') ) {
                            parent = fk;
                            fk = singular(fk);
                            _id = '_id';  
                        }
                    }
                    insert += tab+fk+_id+',\n';
                }
                for( let j = 0; j < this.children.length; j++ ) {
                    let child = this.children[j];
                    if( idColName != null && child.parseName() == 'id' )
                        continue;
                    if (child.refId() == null  ) {
                        if( child.isOption('pk') )
                            continue; //insert += '--';
                        if( 0 == child.children.length ) 
                            insert += tab+child.parseName()+',\n';
                    }
                }
                if( insert.lastIndexOf(',\n') == insert.length-2 )
                    insert = insert.substring(0,insert.length-2)+'\n';

                insert += ') values (\n';

                if( idColName != null ) {
                    pkValue = i+1;
                    insert += tab + pkValue + ',\n'; 
                } else {
                    let pkName = this.getExplicitPkName();
                    if( pkName != null ) {
                        const field = pkName;
                        let tmp = getValue(ddl.data, null /*no name at level 0*/, field, this.parseName());
                        let v = -1;
                        if( elem != null )
                            v = elem[field];
                        if( tmp != null && tmp[i] != null ) {
                                v = tmp[i];
                        }
                        if( v.replaceAll )
                            v = "'"+v+"'";
                        pkValue = v != -1 ? v : i+1;
                        insert += tab + pkValue + ',\n';  
                    }
                }
                
                for( let fk in this.fks ) {
                    let ref = this.fks[fk];
                    let refNode = ddl.find(ref);
                    let values = [];
                    let type = 'INTEGER';
                    for( let k = 1; k <= refNode.cardinality() ; k++ )
                        values.push(k);      
                    if( elem != null ) {
                        let refData = elem[fk];
                        if( refData != null ) {
                            if( typeof refData == 'string' )
                                type = "STRING"; // not INTEGER
                            values = [];
                            values[0] = refData;                                
                        } else {
                            const m2mTbl = objName+'_'+ref;
                            const m2mData = ddl.data[m2mTbl];
                            if( m2mData != null ) {
                                for( const i in m2mData ) {
                                    if( m2mData[i][objName+'_id'] == pkValue ) {
                                        const refData = m2mData[i][fk];
                                        if( refData != null ) {
                                            if( typeof refData == 'string' )
                                                type = "STRING"; // not INTEGER
                                            values = [];
                                            values[0] = refData;                                
                                        }       
                                        break;
                                    }
                                }   
                            } else {
                                let fk1 = refNode.getPkName();
                                let refData = elem[fk1];
                                if( refData != null ) {
                                    if( typeof refData == 'string' )
                                        type = "STRING"; // not INTEGER
                                    values = [];
                                    values[0] = refData;                                
                                }
                            }
                        }
                    } 
                    insert += tab+translate(ddl.getOptionValue('Data Language'),generateSample(objName,singular(ref)+'_id', type, values))+',\n';
                }
                for( let j = 0; j < this.children.length; j++ ) {
                    let child = this.children[j]; 
                    if( idColName != null && child.parseName() == 'id' )
                        continue;
                    if (child.refId() == null  ) {
                        if( child.parseName() == this.getExplicitPkName() )
                            continue; //insert += '--';
                        if( 0 == child.children.length )  {
                            let values = child.parseValues();
                            let cname = child.parseName();
                            if( elem != null ) {
                                let v = elem[cname];
                                if( v != null ) {
                                    values = [];
                                    values[0] = v;
                                }                                   
                            }
                            /*let tmp = getValue(ddl.data, null no name at level 0, cname, this.parseName());
                            if( tmp != null && tmp[i] != null ) {
                                values = [];
                                values[0] = tmp[i];
                            }*/
                            let datum = generateSample(objName, cname, child.parseType(pure=>true), values);
                            insert += tab + translate(ddl.getOptionValue('Data Language'), datum)+',\n';
                        }
                    }
                }
                if( insert.lastIndexOf(',\n') == insert.length-2 )
                    insert = insert.substring(0,insert.length-2)+'\n';
                insert += ');\n';
            }
 
            if( insert != '' )    
                insert += '\ncommit;\n\n';

            let idColName = this.getGenIdColName();
            if( idColName != null && 1 < this.cardinality() && !ddl.optionEQvalue('pk','guid') ) {
                insert += 'alter table '+objName+'\n'
              + 'modify '+idColName+' generated '+'always '/*'by default on null'*/+' as identity restart start with '+(this.cardinality()+1)+';\n\n';
            }

            tab2inserts[objName] = insert;
            
            for( let i = 0; i < this.children.length; i++ ) {
                const child = this.children[i]; 
                if( 0 < child.children.length ) {
                    const merged = {...tab2inserts , ...child.inserts4tbl( dataObj )};
                    tab2inserts = merged;
                }
            }

            return tab2inserts;
        };  
        
        this.isArray = function(  ) {
            /*if (this.content.includes('/array'))
                return true;
            var insert = this.content.indexOf('/insert ');
            if (0 < insert) {
                var tokens = this.content.substr(insert).split(/\s+/);
                return parseInt(tokens[1]) > 1;
            }*/
            if( !this.isMany2One() && this.parent != null )
                return true;
            return false;
        };
        this.hasNonArrayChildId = function( cname ) {
            if(!cname.endsWith('_id'))
                return false;
            var name = cname.slice(0, -3); 
            return this.children.some((c) => c.children.length > 0 &&
             c.parseName() == name && !c.isArray());
        };

        this.generateDualityView = function() {
            return '/* not supported yet*/';
        };

        this.getTransColumns = function() {
            let cols = [];
            for (let i = 0; i < this.children.length; i++) {
                let child = this.children[i];
                if (child.isOption('trans') || child.isOption('translation') || child.isOption('translations'))
                    cols.push(child);
            }
            return cols;
        };

        this.getBaseType = function() {
            let type = this.parseType(true);
            let idx = type.indexOf(' not null');
            if (idx > 0) type = type.substring(0, idx);
            idx = type.indexOf('\n');
            if (idx > 0) type = type.substring(0, idx);
            return type;
        };

        this.generateTransTable = function() {
            if (this.parseType() != 'table')
                return '';
            let transCols = this.getTransColumns();
            if (transCols.length == 0)
                return '';

            let objName = ddl.objPrefix() + this.parseName();
            let transName = objName + '_trans';
            let char = ddl.semantics();

            // Determine max column name length for alignment
            let maxLen = 'language_code'.length;
            let fkColName = singular(this.parseName()) + '_id';
            if (fkColName.length > maxLen) maxLen = fkColName.length;
            for (let i = 0; i < transCols.length; i++) {
                let colName = 'trans_' + transCols[i].parseName();
                if (colName.length > maxLen) maxLen = colName.length;
            }
            if ('id'.length > maxLen) maxLen = 'id'.length;

            let ret = '';

            // Create _trans table
            ret += 'create table ' + transName + ' (\n';

            // id column - same PK strategy as parent
            let pad = tab + ' '.repeat(maxLen - 'id'.length);
            let typeModifier = 'not null';
            if (ddl.optionEQvalue('pk', 'identityDataType'))
                typeModifier = 'generated by default on null as identity';
            if (ddl.optionEQvalue('pk', 'seq'))
                typeModifier = 'default on null ' + transName + '_seq.nextval';
            if (ddl.optionEQvalue('pk', 'guid'))
                typeModifier = 'default on null to_number(sys_guid(), \'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\') ';
            ret += tab + 'id' + pad + 'number ' + typeModifier + '\n';
            ret += tab + tab + ' '.repeat(maxLen) + 'constraint ' + transName + '_id_pk primary key,\n';

            // FK to parent table
            pad = tab + ' '.repeat(maxLen - fkColName.length);
            ret += tab + fkColName + pad + 'number not null,\n';

            // language_code FK
            pad = tab + ' '.repeat(maxLen - 'language_code'.length);
            ret += tab + 'language_code' + pad + 'varchar2(5' + char + ') not null,\n';

            // translated columns
            for (let i = 0; i < transCols.length; i++) {
                let colName = 'trans_' + transCols[i].parseName();
                pad = tab + ' '.repeat(maxLen - colName.length);
                let baseType = transCols[i].getBaseType();
                let comma = (i < transCols.length - 1) ? ',' : ',';
                ret += tab + colName + pad + baseType + comma + '\n';
            }

            // Unique constraint
            ret += tab + 'constraint ' + transName + '_uk unique (' + fkColName + ', language_code)\n';
            ret += ');\n\n';

            // FK constraint to parent
            let abbrev = this.parseName();
            if (abbrev.length > 2)
                abbrev = abbrev.substring(0, 2);
            ret += 'alter table ' + transName + ' add constraint ' + transName + '_' + abbrev + '_id_fk\n';
            ret += tab + 'foreign key (' + fkColName + ') references ' + objName + ';\n\n';

            // FK constraint to language
            ret += 'alter table ' + transName + ' add constraint ' + transName + '_lang_fk\n';
            ret += tab + 'foreign key (language_code) references ' + ddl.objPrefix() + 'language (code);\n\n';

            // Indexes
            ret += 'create index ' + transName + '_i1 on ' + transName + ' (' + fkColName + ');\n';
            ret += 'create index ' + transName + '_i2 on ' + transName + ' (language_code);\n\n';

            return ret;
        };

        this.generateResolvedView = function() {
            if (this.parseType() != 'table')
                return '';
            let transCols = this.getTransColumns();
            if (transCols.length == 0)
                return '';

            let objName = ddl.objPrefix() + this.parseName();
            let transName = objName + '_trans';
            let viewName = objName + '_resolved';
            let fkColName = singular(this.parseName()) + '_id';
            let transContext = ddl.getOptionValue('transcontext');

            let ret = 'create or replace view ' + viewName + ' as\n';
            ret += 'select ';

            // Collect all columns for SELECT
            let selectCols = [];

            // id column
            let idColName = this.getGenIdColName();
            if (idColName != null) {
                selectCols.push('k.' + idColName);
            } else {
                let pkName = this.getExplicitPkName();
                if (pkName != null)
                    selectCols.push('k.' + pkName);
            }

            // FK columns
            this.lateInitFks();
            for (let fk in this.fks) {
                if (0 < fk.indexOf(',')) continue;
                let refNode = ddl.find(this.fks[fk]);
                let _id = '';
                if (refNode != null && refNode.isMany2One && refNode.isMany2One() && !fk.endsWith('_id')) {
                    _id = '_id';
                }
                selectCols.push('k.' + fk + _id);
            }

            // Regular and translated columns
            let transColNames = {};
            for (let i = 0; i < transCols.length; i++)
                transColNames[transCols[i].parseName()] = true;

            for (let i = 0; i < this.children.length; i++) {
                let child = this.children[i];
                if (child.children.length > 0) continue;
                if (child.refId() != null) continue;
                let cname = child.parseName();
                if (idColName != null && cname == 'id') continue;
                if (cname == this.getExplicitPkName()) continue;

                if (transColNames[cname]) {
                    selectCols.push('coalesce(t.trans_' + cname + ', k.' + cname + ') as ' + cname);
                } else {
                    selectCols.push('k.' + cname);
                }
            }

            ret += selectCols[0] + ',\n';
            for (let i = 1; i < selectCols.length; i++) {
                ret += tab + tab + ' ' + selectCols[i];
                if (i < selectCols.length - 1)
                    ret += ',';
                ret += '\n';
            }

            ret += 'from ' + objName + ' k\n';
            ret += 'left join ' + transName + ' t\n';
            ret += tab + 'on t.' + fkColName + ' = k.' + (idColName || this.getExplicitPkName()) + '\n';
            ret += tab + 'and t.language_code = ' + transContext + ';\n\n';

            return ret;
        };

    }

    function recognize( parsed ) {
        ddl = parsed;
        const fullInput = parsed.input;

        let path = [];
        let ret = [];

        const src = lexer(fullInput+'\n',true,true,'`');
        ddl.data = null;
        let poundDirective = null;
        let line = '';
        OUTER: for( let i = 0; i < src.length; i++ ) {
            const t = src[i];

            if( t.value == '\n' ) {
                if( poundDirective == null ) {
                    line = line.replace(/\r/g,'');
                    let nc = line.replace(/\r/g,'').replace(/ /g,'');
                    // if( /[^a-zA-Z0-9="{}\/.,_\-\[\]]/.test(nc) ) 
                    //     continue;
                    if( '' == nc ) {
                        line = '';
                        continue;
                    }
                    let node = new ddlnode(t.line-1,line,null);  // node not attached to anything        
                    let matched = false;
                    for( let j = 0; j < path.length; j++ ) {
                        let cmp = path[j];
                        if( node.apparentDepth() <= cmp.apparentDepth() ) {
                            if( 0 < j ) {
                                let parent = path[j-1];
                                node = new ddlnode(t.line-1,line,parent);  // attach node to parent
                                path[j] = node;
                                path = path.slice(0, j+1);
                                matched = true;
                                break;
                            } else {
                                path[0] = node;
                                path = path.slice(0, 1);
                                ret.push(node);
                                matched = true;
                            }
                        } 
                    }
                    if( !matched ) {
                        if( 0 < path.length ) {
                            let parent = path[path.length-1];
                            node = new ddlnode(t.line-1,line,parent);
                        }
                        path.push(node);
                        if( node.apparentDepth() == 0 )
                            ret.push(node);
                    }
                    if( node.isMany2One() ) {
                        const parent = node.parent;
                        if( parent.fks == null )
                            parent.fks = [];
                        let refId = node.refId();
                        if( refId == null )
                            refId = node.parseName();
                        parent.fks[node.parseName()+'_id'] = refId;
                    }

                    line = '';
                    continue;
                }
            }

            if( poundDirective == null && t.value == '#' ) {
                poundDirective = '';
                continue;
            }
            if( poundDirective != null ) {
                poundDirective += t.value;
                if( t.value != '\n' && t.value != '}' )
                    continue;
                const src1 = lexer(poundDirective,false,true,'');
                if( src1.length%4 == 3 && src1[1].value == ':' ) {
                    parsed.setOptions(poundDirective);
                    poundDirective = null;
                    line = '';
                    continue;
                }
                let flattened = null;
                let document = null;
                let settings = null;
                for( let j in src1 ) {
                    const t1 = src1[j];
                    if( flattened == null && t1.value == 'flattened' ) {
                        flattened = '';
                        continue;
                    }
                    if( flattened != null ) {
                        flattened += t1.value;
                        if( flattened == '=' )
                            continue;
                        if( flattened.charAt(flattened.length-1)!='}' )
                            continue;
                        let jsonStr = flattened.substring(1);
                        try {
                            ddl.data = JSON.parse(jsonStr);
                            poundDirective = null;
                            line = '';
                            continue OUTER;
                        } catch( error ) {}        
                    }
                    if( settings == null && t1.value == 'settings' ) {
                        settings = '';
                        continue;
                    }
                    if( settings != null ) {
                        settings += t1.value;
                        //if( settings == '=' )
                            //continue;
                        let jsonStr = settings.substring(1);
                        try {
                            parsed.setOptions(settings);
                            poundDirective = null;
                            line = '';
                            continue OUTER;
                        } catch( error ) {}        
                    }
                }
                //poundDirective = null;
            }
            if( t.type == 'comment' ) {
                continue;
            }
            if( t.type == 'line-comment' ) {  
                if( 0 < line.trim().length ) {
                    line += t.value;
                }
                continue;
            }
            line += t.value;
        }          
        
        return ret;
    }


    function getValue( obj, oName, attr, oName2Match ) {
        let ret =  [];
        if( obj == null )
            return null;
        if( typeof obj != 'object' )
            return null;
        let tmp = obj[attr];
        if( tmp != null && oName == oName2Match ) {
            ret.push(tmp); 
        }
        for( var p in obj ) {
            let child = obj[p];
            tmp = getValue(child, p, attr, oName2Match);
            if( tmp != null )
                ret = ret.concat(tmp);
        }
        return ret;
    }

    return recognize;
}());

export default tree;
