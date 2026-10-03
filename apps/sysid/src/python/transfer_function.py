# Verbatim from upstream SysID/SysID.js run_transfer_function_ID.
# Inputs are Python globals set by runtime.ts; results are read back from the *_js globals.
from pyodide.ffi import to_js
import numpy as np
import math
from scipy.signal import butter,filtfilt
import sympy as sp
from AircraftIden import FreqIdenSIMO, TransferFunctionFit, TransferFunctionParamModel
from AircraftIden.TransferFunctionFit import plot_fitter
from AircraftIden.FreqIden import time_seq_preprocess
import matplotlib
plt = matplotlib.pyplot
t_start = float(t_start)
t_end = float(t_end)
f_start = float(f_start)
f_end = float(f_end)
f_cutoff = float(f_cutoff)/(2*3.14)
matplotlib.use("module://matplotlib_pyodide.html5_canvas_backend")

def butter_lowpass(cutoff, fs, order=5):
    nyquist = 0.5 * fs
    normal_cutoff = cutoff / nyquist
    b, a = butter(order, normal_cutoff, btype='low', analog=False)
    return b, a


def apply_lowpass_filter(data, cutoff, fs, order=5):
    b, a = butter_lowpass(cutoff, fs, order=order)
    y = filtfilt(b, a, data)
    return y

time_seq_source = np.array(time_data).flatten()/1000000
input_data = np.array(input_data)
output_data = np.array(output_data)
dt = np.mean(np.diff(time_seq_source))

u = apply_lowpass_filter(input_data, f_cutoff, 1/dt)
y = apply_lowpass_filter(output_data, f_cutoff, 1/dt)
simo_iden = FreqIdenSIMO(time_seq_source,f_start, f_end, u, y, win_num=None)

plt.rc("figure", figsize=(15,10))
plt.figure("pout->udot")
simo_iden.plt_bode_plot(0)

s = sp.symbols("s")
tau = sp.symbols("tau")

freq, H, gamma2, gxx, gxy, gyy = simo_iden.get_freq_iden(0)

tf_params = sp.symbols(str(symbols))
num = sp.simplify(str(numerator))
den = sp.simplify(str(denominator))
tfpm = TransferFunctionParamModel(num, den, tau)
fitter = TransferFunctionFit(freq, H, gamma2, tfpm, nw=20, iter_times=1, reg = 0.1)
init_val = fitter.setup_initvals_ARX(num, den, u, y, dt)

tf = fitter.estimate(f_start, f_end, accept_J=100, init_val=init_val)
num, den, tau = fitter.get_coefficients()
print("numerator: ",num)
print("denominator: ",den)
print("tau: ",tau)
#plot_fitter(fitter,str(input_field)+"->"+str(output_field))
#plt.show()
H, freq, mag, phase, h_amp, h_phase, coherence = fitter.provide_plot_arrays()

# Export arrays to JavaScript
H_js = to_js(H.tolist())
freq_js = to_js(freq.tolist())
mag_js = to_js(mag.tolist())
phase_js = to_js(phase.tolist())
h_amp_js = to_js(h_amp.tolist())
h_phase_js = to_js(h_phase.tolist())
coherence_js = to_js(coherence.tolist())
