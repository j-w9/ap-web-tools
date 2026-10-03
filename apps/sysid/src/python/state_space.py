# Verbatim from upstream SysID/SysID.js run_SS_ID.
# Inputs are Python globals set by runtime.ts; results are read back from the *_js globals.
from pyodide.ffi import to_js
from AircraftIden import FreqIdenSIMO, TransferFunctionFit
import math
import matplotlib.pyplot as plt
import control
from scipy.signal import butter,filtfilt

import sympy as sp
from AircraftIden.StateSpaceIden import StateSpaceIdenSIMO, StateSpaceParamModel
from AircraftIden.FreqIden import time_seq_preprocess

import numpy as np
import csv
import sympy as sp

M = sp.Matrix(np.eye(int(orderA)))

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

output_data = [np.array(data) for data in output_data]

f_cutoff = float(f_cutoff)/(2*3.14)

dt = np.mean(np.diff(time_seq_source))

input_data = apply_lowpass_filter(input_data, f_cutoff, 1/dt)
output_data = [apply_lowpass_filter(data, f_cutoff, 1/dt) for data in output_data]

syms = []
sym_var = list(sym_var)

def tofloat(element):
  try:
    float(element)
    return True
  except ValueError:
    return False

def callback(xk, state):
  print(xk)
  print(state)

def getMatrixJs(mjs, num_rows, num_cols, sym_var):
  ans = []
  for i in range(num_rows):
    empty_row = []
    for j in range(num_cols):
      if tofloat(str(mjs[i][j])):
        empty_row.append(float(str(mjs[i][j])))
      elif mjs[i][j][0] == '-':
        temp = sp.Symbol(mjs[i][j][1:])
        if temp in syms:
          raise TypeError("duplicate symbol")
        syms.append(temp)
        empty_row.append(-temp)
      else:
        temp = sp.Symbol(mjs[i][j])
        if temp in syms:
          raise TypeError("duplicate symbol")
        syms.append(temp)
        empty_row.append(temp)
    ans.append(empty_row)

  return ans

F = getMatrixJs(matrixA, orderA, orderA, sym_var)
G = getMatrixJs(matrixB, orderA, numInputs, sym_var)
H0 = getMatrixJs(matrixH0, numOutputs, orderA, sym_var)
H1 = getMatrixJs(matrixH1, numOutputs, orderA, sym_var)

t_start = float(t_start)
t_end = float(t_end)

F = sp.Matrix(F)
G = sp.Matrix(G)
H0 = sp.Matrix(H0)
H1 = sp.Matrix(H1)
bnd = tuple(bounds_array)
con_str = list(con_str)

f_start = float(f_start)
f_end = float(f_end)
simo_iden = FreqIdenSIMO(time_seq_source, f_start, f_end, input_data, *output_data, win_num=None)

plt.rc("figure", figsize=(15,10))
plt.figure("pout->udot")
simo_iden.plt_bode_plot(0)
LatdynSSPM = StateSpaceParamModel(M, F, G, H0, H1, syms)

plt.rc('figure', figsize=(10.0, 5.0))
freqres = simo_iden.get_freqres()
if len(con_str[0]) == 0:
  ssm_iden = StateSpaceIdenSIMO(freqres, accept_J=100,
                      enable_debug_plot=False,
                      y_names=["r"], reg=0.1, iter_callback=callback, max_sample_times=1)

else:
  ssm_iden = StateSpaceIdenSIMO(freqres, accept_J=100,
                      enable_debug_plot=False,
                      y_names=["r"], reg=0.1, iter_callback=callback, max_sample_times=1, con_str = con_str)


J, ssm = ssm_iden.estimate(LatdynSSPM, syms, constant_defines={}, rand_init_max=10, bounds = bnd)
ssm.check_stable()
ssm_iden.print_res()
#ssm_iden.draw_freq_res()
#plt.show()
freq_res_data = ssm_iden.get_freq_res_data()

freq_js = to_js(freq_res_data["freq"])
Hs_amp_js = to_js(freq_res_data["Hs_amp"])
Hs_pha_js = to_js(freq_res_data["Hs_pha"])
Hest_amp_js = to_js(freq_res_data["Hest_amp"])
Hest_pha_js = to_js(freq_res_data["Hest_pha"])
coherence_js = to_js(freq_res_data["coherence"])
