#!/usr/bin/env node

var amp = require('./')

var help = false
var dashdash = false
var args = process.argv.slice(2).filter(function(arg) {
  if (dashdash)
    return !!arg
  else if (arg === '--')
    dashdash = true
  else if (arg.match(/^(-+|\/)(h(elp)?|\?)$/))
    help = true
  else
    return !!arg
});

if (help || args.length === 0) {
  // If they didn't ask for help, then this is not a "success"
  var log = help ? console.log : console.error
  log('Usage: amp-optimizer --source=[path_to_src] --namespace=[module_namespace] [--output=path_to_output]')
  log('')
  log('  Creates a single JavaScript output file from a recursive path of source files using an augmented module pattern for a given namespace.')
  log('')
  log('Options:')
  log('')
  log('  -h, --help    Display this usage info')
  process.exit(help ? 0 : 1)
} else
  go(0)

function go (n) {
  if (n >= args.length)
    return
  amp(args[n], function (er) {
    if (er)
      throw er
    go(n+1)
  })
}
