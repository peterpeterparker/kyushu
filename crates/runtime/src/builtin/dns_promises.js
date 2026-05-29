// node:dns/promises - re-exports the promises API and error codes from node:dns
import dns from 'node:dns';

const { promises } = dns;

export const lookup = promises.lookup;
export const lookupService = promises.lookupService;
export const resolve = promises.resolve;
export const resolve4 = promises.resolve4;
export const resolve6 = promises.resolve6;
export const resolveAny = promises.resolveAny;
export const resolveCname = promises.resolveCname;
export const resolveCaa = promises.resolveCaa;
export const resolveMx = promises.resolveMx;
export const resolveNaptr = promises.resolveNaptr;
export const resolveNs = promises.resolveNs;
export const resolvePtr = promises.resolvePtr;
export const resolveSoa = promises.resolveSoa;
export const resolveSrv = promises.resolveSrv;
export const resolveTxt = promises.resolveTxt;
export const reverse = promises.reverse;
export const setServers = promises.setServers;
export const getServers = promises.getServers;
export const setDefaultResultOrder = promises.setDefaultResultOrder;
export const getDefaultResultOrder = promises.getDefaultResultOrder;
export const Resolver = promises.Resolver;

// Error codes (re-exported from dns for compatibility)
export const NODATA = dns.NODATA;
export const FORMERR = dns.FORMERR;
export const SERVFAIL = dns.SERVFAIL;
export const NOTFOUND = dns.NOTFOUND;
export const NOTIMP = dns.NOTIMP;
export const REFUSED = dns.REFUSED;
export const BADQUERY = dns.BADQUERY;
export const BADNAME = dns.BADNAME;
export const BADFAMILY = dns.BADFAMILY;
export const BADRESP = dns.BADRESP;
export const CONNREFUSED = dns.CONNREFUSED;
export const TIMEOUT = dns.TIMEOUT;
export const EOF = dns.EOF;
export const FILE = dns.FILE;
export const NOMEM = dns.NOMEM;
export const DESTRUCTION = dns.DESTRUCTION;
export const BADSTR = dns.BADSTR;
export const BADFLAGS = dns.BADFLAGS;
export const NONAME = dns.NONAME;
export const BADHINTS = dns.BADHINTS;
export const NOTINITIALIZED = dns.NOTINITIALIZED;
export const LOADIPHLPAPI = dns.LOADIPHLPAPI;
export const ADDRGETNETWORKPARAMS = dns.ADDRGETNETWORKPARAMS;
export const CANCELLED = dns.CANCELLED;

export default promises;
