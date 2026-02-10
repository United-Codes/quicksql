var split_str = (function(){
    function split_str_into_chunks( text, symbols ) {
        //var symbols = " \n\r\t(){}[]^-|!*+.><='\",;:%@?/\\#~";
        var symbolSet = new Set(symbols);
        var ret = [];
        var last = '';
        for( var i = 0; i < text.length; i++ ) {
            var c = text.charAt(i);
            if( symbolSet.has(c) ) {
                if( 0 < last.length )
                    ret.push(last);
                ret.push(c);
                last = '';
            } else {
                last = last + c;
            }
        }
        if( 0 < last.length )
            ret.push(last);
        return ret;
    }
    return split_str_into_chunks;
}());

export default split_str;
